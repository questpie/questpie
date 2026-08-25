import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type {
	LinkedJobMember,
	LinkedJobProjection,
	LinkedReactionMember,
	LinkedReactionProjection,
} from "../durable";
import { canonicalMutationBytes } from "./canonical";

export type PendingDurableDispatch =
	| Readonly<{
			slot: string;
			resourceKind: "job";
			resource: LinkedJobMember;
			payloadBytes: Uint8Array;
	  }>
	| Readonly<{
			slot: string;
			resourceKind: "reaction";
			resource: LinkedReactionMember;
			payloadBytes: Uint8Array;
	  }>;

type JobReceipt = Readonly<{ runId: string; resource: `job:${string}` }>;

/** One Mutation may accept one transaction-joined durable command or fact. */
export function createDurableDispatch(
	reactions: LinkedReactionProjection,
	jobs: LinkedJobProjection,
	receipt: (slot: string, resource: LinkedJobMember) => JobReceipt,
): Readonly<{
	dispatch: Readonly<Record<string, (payload: unknown) => Promise<void>>>;
	jobs: Readonly<
		Record<
			string,
			Readonly<{ dispatch(payload: unknown): Promise<JobReceipt> }>
		>
	>;
	pending: readonly PendingDurableDispatch[];
}> {
	const pending: PendingDurableDispatch[] = [];
	const accept = (
		slot: string,
		resourceKind: "job" | "reaction",
		resource: LinkedJobMember | LinkedReactionMember,
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
			resourceKind === "job"
				? Object.freeze({
						slot,
						resourceKind,
						resource: resource as LinkedJobMember,
						payloadBytes,
					})
				: Object.freeze({
						slot,
						resourceKind,
						resource: resource as LinkedReactionMember,
						payloadBytes,
					}),
		);
	};
	const dispatch = Object.fromEntries(
		[...reactions.members].map(([member, reaction]) => [
			member,
			async (payload: unknown) => accept(member, "reaction", reaction, payload),
		]),
	);
	const jobMembers = Object.fromEntries(
		[...jobs.members].map(([member, job]) => [
			member,
			Object.freeze({
				async dispatch(payload: unknown) {
					const slot = `job:${member}`;
					accept(slot, "job", job, payload);
					return receipt(slot, job);
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
