import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../../../../packages/runtime/src/codec";
import type { DurableClaim } from "../../../../packages/runtime/src/durable/rows";
import { OperationFailure } from "../../../../packages/runtime/src/operation";
import type { createMutationCheckpointProof } from "./checkpoint";
import { createMutationCheckpointAttempt } from "./checkpoint-attempt";

type Checkpoint = ReturnType<typeof createMutationCheckpointProof>;
type Command = Parameters<Checkpoint["reserve"]>[1];

/** Proof composition for one compiled Mutation, not a generated Job Context. */
export function createMutationCheckpointInvocationProof<Input, Result>(
	options: Readonly<{
		checkpoint: Checkpoint;
		claim: DurableClaim;
		historyLength: number;
		signal?: AbortSignal;
		binding: Readonly<{
			operation: `mutation:${string}`;
			inputCodec: RuntimeCodec;
			contractDigest: string;
			runtimeGraphDigest: string;
			invoke(input: Input, callId: string): Promise<Result>;
		}>;
	}>,
) {
	const { checkpoint, claim } = options;
	const binding = Object.freeze({
		...options.binding,
		inputCodec: decodeRuntimeCodecDescriptor(options.binding.inputCodec),
	});
	const reference = Object.freeze({});
	let captured: Command;
	const attempt = createMutationCheckpointAttempt({
		historyLength: options.historyLength,
		signal: options.signal,
		async reserve(
			raw: Readonly<{ name: string; genuine: boolean; input: Input }>,
			ordinal: number,
		) {
			if (!raw.genuine) throw new Error("CHECKPOINT_REFERENCE_INVALID");
			// The attempt detached raw input synchronously. Store canonical wire
			// values privately; the Mutation receives its own decoded Date objects.
			let encoded: unknown;
			try {
				encoded = encodeRuntimeCodec(
					binding.inputCodec,
					decodeRuntimeCodec(binding.inputCodec, raw.input),
				);
			} catch (error) {
				if (error instanceof RuntimeCodecError)
					throw new OperationFailure("PROTOCOL_UNSUPPORTED");
				throw error;
			}
			captured = Object.freeze({
				name: raw.name,
				ordinal,
				operation: binding.operation,
				input: encoded,
				inputCodec: binding.inputCodec,
				contractDigest: binding.contractDigest,
				runtimeGraphDigest: binding.runtimeGraphDigest,
			});
			const reserved = await checkpoint.reserve(claim, captured);
			if (reserved.status !== "reserved")
				throw new Error(`CHECKPOINT_${reserved.status}`);
			return reserved;
		},
		invoke: (_command, reservation) =>
			binding.invoke(
				decodeRuntimeCodec<Input>(binding.inputCodec, captured.input),
				reservation.callId,
			),
		async complete() {
			const completed = await checkpoint.complete(claim, captured);
			if (completed.status !== "completed")
				throw new Error(`CHECKPOINT_${completed.status}`);
		},
	});
	return Object.freeze({
		reference,
		mutation(name: string, candidate: object, input: Input): Promise<Result> {
			// Resolve provenance before structuredClone erases object identity.
			// Failure still enters the attempt owner and dooms it before dispatch.
			return attempt.mutation({
				name,
				genuine: candidate === reference,
				input,
			});
		},
		finish: attempt.finish,
	});
}
