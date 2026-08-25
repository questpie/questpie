import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type {
	JobAcceptance,
	JobAcceptanceOptions,
	JobAcceptanceReceipt,
	LinkedJobProjection,
	LinkedReactionMember,
	LinkedReactionProjection,
} from "../durable";
import { canonicalMutationBytes } from "./canonical";

export type PendingDurableDispatch = Readonly<{
	slot: string;
	resourceKind: "reaction";
	resource: LinkedReactionMember;
	payloadBytes: Uint8Array;
}>;

/** Reactions retain one legacy fact slot; Jobs use independently keyed acceptance. */
export function createDurableDispatch(
	reactions: LinkedReactionProjection,
	jobs: LinkedJobProjection,
	jobAcceptance: JobAcceptance,
): Readonly<{
	dispatch: Readonly<Record<string, (payload: unknown) => Promise<void>>>;
	jobs: Readonly<
		Record<
			string,
			Readonly<{
				accept(
					payload: unknown,
					options: JobAcceptanceOptions,
				): Promise<JobAcceptanceReceipt>;
			}>
		>
	>;
	pending: readonly PendingDurableDispatch[];
}> {
	const pending: PendingDurableDispatch[] = [];
	const accept = (
		slot: string,
		resource: LinkedReactionMember,
		payload: unknown,
	) => {
		if (pending.length >= 1)
			throw new TypeError(
				"Mutation exceeded its pending durable dispatch limit",
			);
		const decoded = decodeRuntimeCodec(
			resource.input,
			payload,
			`$dispatch.${slot}`,
		);
		const payloadBytes = canonicalMutationBytes(
			encodeRuntimeCodec(resource.input, decoded, `$dispatch.${slot}`),
		);
		if (payloadBytes.byteLength > 262_144)
			throw new TypeError("Durable payload exceeds its byte limit");
		pending.push(
			Object.freeze({
				slot,
				resourceKind: "reaction" as const,
				resource,
				payloadBytes,
			}),
		);
	};
	const dispatch = Object.fromEntries(
		[...reactions.members].map(([member, reaction]) => [
			member,
			async (payload: unknown) => accept(member, reaction, payload),
		]),
	);
	const jobMembers = Object.fromEntries(
		[...jobs.members].map(([member, job]) => [
			member,
			Object.freeze({
				async accept(payload: unknown, options: JobAcceptanceOptions) {
					return jobAcceptance.accept(job, payload, options);
				},
			}),
		]),
	);
	return Object.freeze({
		dispatch: Object.freeze(dispatch),
		jobs: Object.freeze(jobMembers),
		pending,
	});
}
