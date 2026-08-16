import {
	decodeRuntimeCodec,
	decodeRuntimeCodecDescriptor,
	encodeRuntimeCodec,
	type RuntimeCodec,
} from "../codec";
import { canonicalMutationBytes } from "./canonical";

type RecordValue = Readonly<Record<string, unknown>>;

export type PendingReactionDispatch = Readonly<{
	slot: string;
	target: string;
	payloadBytes: Uint8Array;
}>;

export type LinkedReactionProjection = Readonly<{
	members: ReadonlyMap<
		string,
		Readonly<{ identity: string; input: RuntimeCodec }>
	>;
}>;

function fail(message: string): never {
	throw new TypeError(`Invalid Reaction projection: ${message}`);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as RecordValue;
}

function exact(value: RecordValue, keys: readonly string[], label: string) {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} has invalid keys`);
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	return value;
}

export function linkReactionProjection(
	value: unknown,
): LinkedReactionProjection {
	const source = record(value, "artifact");
	exact(source, ["format", "version", "reactions"], "artifact");
	if (
		source.format !== "questpie.reaction-projection" ||
		source.version !== 1 ||
		!Array.isArray(source.reactions)
	)
		fail("artifact header is invalid");
	const members = new Map<
		string,
		Readonly<{ identity: string; input: RuntimeCodec }>
	>();
	const identities = new Set<string>();
	let previousIdentity: string | null = null;
	for (const [index, candidate] of source.reactions.entries()) {
		const reaction = record(candidate, `reaction ${index}`);
		exact(reaction, ["identity", "input", "origin"], `reaction ${index}`);
		const identity = requiredText(
			reaction.identity,
			`reaction ${index} identity`,
		);
		if (
			!identity.startsWith("reaction:") ||
			identity.length === "reaction:".length
		)
			fail(`reaction ${index} identity is invalid`);
		if (previousIdentity !== null && identity <= previousIdentity)
			fail("reactions must be unique and identity-sorted");
		previousIdentity = identity;
		const member = identity.slice("reaction:".length);
		if (member.includes(":")) fail(`reaction ${index} identity is invalid`);
		const origin = record(reaction.origin, `reaction ${index} origin`);
		exact(
			origin,
			["path", "exportName", "packageId"],
			`reaction ${index} origin`,
		);
		requiredText(origin.path, `reaction ${index} origin path`);
		requiredText(origin.exportName, `reaction ${index} origin exportName`);
		if (origin.packageId !== null)
			requiredText(origin.packageId, `reaction ${index} origin packageId`);
		if (identities.has(identity) || members.has(member))
			fail(`reaction ${index} identity or member is duplicated`);
		identities.add(identity);
		members.set(
			member,
			Object.freeze({
				identity,
				input: decodeRuntimeCodecDescriptor(
					reaction.input,
					`$reactionProjection.reactions[${index}].input`,
				),
			}),
		);
	}
	return Object.freeze({ members });
}

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
				pending.push(
					Object.freeze({
						slot: member,
						target: reaction.identity,
						payloadBytes,
					}),
				);
			},
		]),
	);
	return Object.freeze({ dispatch: Object.freeze(dispatch), pending });
}
