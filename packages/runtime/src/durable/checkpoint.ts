import {
	decodeRuntimeCodec,
	encodeRuntimeCodec,
	type RuntimeCodec,
	RuntimeCodecError,
} from "../codec";
import { canonicalMutationBytes, mutationDigest } from "../mutation/canonical";
import { OperationFailure } from "../operation";
import { createMutationCheckpointAttemptOwner } from "./checkpoint-attempt";
import { DurableCheckpointError } from "./checkpoint-contract";
import {
	type createPostgresMutationCheckpointStore,
	type MutationCheckpointCommand,
} from "./checkpoint-postgres";
import { DurableLeaseLost } from "./effects";
import type { DurableClaim } from "./rows";

type Binding = Readonly<{
	identity: `mutation:${string}`;
	input: RuntimeCodec;
	output: RuntimeCodec;
	contractDigest: string;
	runtimeGraphDigest: string;
}>;
type Captured = Readonly<{ name: string; binding: Binding; input: unknown }>;
type Raw = Readonly<{ name: string; reference: object; input: unknown }>;

/** One attempt's inert references, captured commands, and terminal join. */
export async function createMutationCheckpointRun(
	options: Readonly<{
		store: ReturnType<typeof createPostgresMutationCheckpointStore>;
		claim: DurableClaim;
		signal: AbortSignal;
		bindings: readonly Binding[];
		invoke(
			binding: Binding,
			input: unknown,
			reservation: Readonly<{
				callId: string;
				state: "reserved" | "completed";
				receiptTransactionId: string | null;
				receiptResultDigest: string | null;
			}>,
		): Promise<unknown>;
	}>,
) {
	const historyLength = await options.store.load(options.claim);
	const references = new Map<string, object>();
	const bindings = new WeakMap<object, Binding>();
	for (const binding of options.bindings) {
		const reference = Object.freeze({ identity: binding.identity });
		references.set(binding.identity, reference);
		bindings.set(reference, binding);
	}
	const reserve = async (captured: Captured, ordinal: number) => {
		const command: MutationCheckpointCommand = Object.freeze({
			ordinal,
			name: captured.name,
			operation: captured.binding.identity,
			input: captured.input,
			inputCodec: captured.binding.input,
			contractDigest: captured.binding.contractDigest,
			runtimeGraphDigest: captured.binding.runtimeGraphDigest,
		});
		const reservation = await options.store.reserve(options.claim, command);
		if (reservation.status === "fenced") throw new DurableLeaseLost();
		if (reservation.status !== "reserved") throw new DurableCheckpointError();
		return Object.freeze({ command, reservation });
	};
	const owner = createMutationCheckpointAttemptOwner<
		Captured,
		unknown,
		Awaited<ReturnType<typeof reserve>>,
		Raw
	>({
		historyLength,
		signal: options.signal,
		capture(raw) {
			const binding = bindings.get(raw.reference);
			if (
				!binding ||
				typeof raw.name !== "string" ||
				!/^[A-Za-z0-9_-]{1,64}$/u.test(raw.name)
			)
				throw new DurableCheckpointError();
			let input: unknown;
			try {
				input = encodeRuntimeCodec(
					binding.input,
					decodeRuntimeCodec(binding.input, raw.input),
				);
			} catch (error) {
				if (error instanceof RuntimeCodecError)
					throw new OperationFailure("PROTOCOL_UNSUPPORTED");
				throw error;
			}
			if (canonicalMutationBytes(input).byteLength > 1_048_576)
				throw new DurableCheckpointError("RESOURCE_LIMIT");
			return Object.freeze({ name: raw.name, binding, input });
		},
		reserve,
		invoke: (captured, { reservation }) =>
			options.invoke(
				captured.binding,
				decodeRuntimeCodec(captured.binding.input, captured.input),
				reservation,
			),
		async complete(captured, _ordinal, { command }, result) {
			const resultDigest = mutationDigest(
				canonicalMutationBytes(
					encodeRuntimeCodec(
						captured.binding.output,
						decodeRuntimeCodec(captured.binding.output, result),
					),
				),
			);
			const completion = await options.store.complete(
				options.claim,
				command,
				resultDigest,
			);
			if (completion.status === "fenced") throw new DurableLeaseLost();
			if (completion.status !== "completed") throw new DurableCheckpointError();
		},
	});
	return Object.freeze({
		reference(identity: string) {
			const reference = references.get(identity);
			if (!reference) throw new DurableCheckpointError();
			return reference;
		},
		step: Object.freeze({
			mutation: (name: string, reference: object, input: unknown) =>
				owner.mutation({ name, reference, input }),
		}),
		finish: owner.finish,
	});
}
