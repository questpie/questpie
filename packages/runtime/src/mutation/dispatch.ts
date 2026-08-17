import { decodeRuntimeCodec, encodeRuntimeCodec } from "../codec";
import type {
	LinkedReactionMember,
	LinkedReactionProjection,
} from "../durable/projection";
import { canonicalMutationBytes } from "./canonical";

export type PendingReactionDispatch = Readonly<{
	slot: string;
	reaction: LinkedReactionMember;
	payloadBytes: Uint8Array;
}>;

/** BETA-06 accepts at most one transaction-joined intent per Mutation. */
export function createReactionDispatch(
	projection: LinkedReactionProjection,
): Readonly<{
	dispatch: Readonly<Record<string, (payload: unknown) => Promise<void>>>;
	pending: readonly PendingReactionDispatch[];
}> {
	const pending: PendingReactionDispatch[] = [];
	const dispatch = Object.fromEntries(
		[...projection.members].map(([member, reaction]) => [
			member,
			async (payload: unknown) => {
				if (pending.length >= 1)
					throw new TypeError(
						"Mutation exceeded its pending Reaction intent limit",
					);
				const decoded = decodeRuntimeCodec(
					reaction.input,
					payload,
					`$dispatch.${member}`,
				);
				const payloadBytes = canonicalMutationBytes(
					encodeRuntimeCodec(reaction.input, decoded, `$dispatch.${member}`),
				);
				if (payloadBytes.byteLength > 262_144)
					throw new TypeError("Reaction payload exceeds its byte limit");
				pending.push(Object.freeze({ slot: member, reaction, payloadBytes }));
			},
		]),
	);
	return Object.freeze({ dispatch: Object.freeze(dispatch), pending });
}
