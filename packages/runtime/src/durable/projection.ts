import { decodeRuntimeCodecDescriptor, type RuntimeCodec } from "../codec";

type RecordValue = Readonly<Record<string, unknown>>;

export type LinkedDeclaredError = Readonly<{
	code: string;
	status: number;
	payload: RuntimeCodec | null;
}>;

export type LinkedReactionRetry = Readonly<{
	maximumAttempts: number;
	initialDelayMilliseconds: number;
	backoff: "exponential";
	maximumDelayMilliseconds: number;
	jitter: "full";
	horizonMilliseconds: number;
}>;

export type LinkedReactionMember = Readonly<{
	identity: string;
	member: string;
	input: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: Readonly<Record<string, LinkedDeclaredError>>;
	runAs: Readonly<{ actor: "caller"; whenDenied: "fail" }>;
	retry: LinkedReactionRetry;
	effects: readonly string[];
	contractDigest: string;
}>;

export type LinkedReactionProjection = Readonly<{
	members: ReadonlyMap<string, LinkedReactionMember>;
	byIdentity: ReadonlyMap<string, LinkedReactionMember>;
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

function digestText(value: unknown, label: string): string {
	const text = requiredText(value, label);
	if (!/^[0-9a-f]{64}$/.test(text)) fail(`${label} is not a SHA-256 digest`);
	return text;
}

function boundedInteger(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
): number {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		fail(`${label} is outside ${minimum}..${maximum}`);
	return value;
}

function linkRetry(value: unknown, label: string): LinkedReactionRetry {
	const retry = record(value, label);
	exact(
		retry,
		[
			"maximumAttempts",
			"initialDelayMilliseconds",
			"backoff",
			"maximumDelayMilliseconds",
			"jitter",
			"horizonMilliseconds",
		],
		label,
	);
	if (retry.backoff !== "exponential" || retry.jitter !== "full")
		fail(`${label} is outside the accepted retry program`);
	const initialDelayMilliseconds = boundedInteger(
		retry.initialDelayMilliseconds,
		`${label}.initialDelayMilliseconds`,
		1,
		900_000,
	);
	const maximumDelayMilliseconds = boundedInteger(
		retry.maximumDelayMilliseconds,
		`${label}.maximumDelayMilliseconds`,
		initialDelayMilliseconds,
		900_000,
	);
	return Object.freeze({
		maximumAttempts: boundedInteger(
			retry.maximumAttempts,
			`${label}.maximumAttempts`,
			1,
			8,
		),
		initialDelayMilliseconds,
		backoff: "exponential" as const,
		maximumDelayMilliseconds,
		jitter: "full" as const,
		horizonMilliseconds: boundedInteger(
			retry.horizonMilliseconds,
			`${label}.horizonMilliseconds`,
			maximumDelayMilliseconds,
			86_400_000,
		),
	});
}

function linkDeclaredErrors(
	value: unknown,
	label: string,
): Readonly<Record<string, LinkedDeclaredError>> {
	const errors = record(value, label);
	return Object.freeze(
		Object.fromEntries(
			Object.entries(errors).map(([key, candidate]) => {
				const declared = record(candidate, `${label}.${key}`);
				exact(declared, ["code", "status", "payload"], `${label}.${key}`);
				return [
					key,
					Object.freeze({
						code: requiredText(declared.code, `${label}.${key}.code`),
						status: boundedInteger(
							declared.status,
							`${label}.${key}.status`,
							400,
							599,
						),
						payload:
							declared.payload === null
								? null
								: decodeRuntimeCodecDescriptor(
										declared.payload,
										`${label}.${key}.payload`,
									),
					}),
				];
			}),
		),
	);
}

function linkEffects(value: unknown, label: string): readonly string[] {
	if (!Array.isArray(value)) fail(`${label} must be an array`);
	const names = value.map((name, index) => {
		const text = requiredText(name, `${label}[${index}]`);
		if (!/^[a-z][a-z0-9-]{0,62}$/.test(text))
			fail(`${label}[${index}] is not a literal effect name`);
		return text;
	});
	if (names.length > 8) fail(`${label} declares more than 8 effect names`);
	if (names.some((name, index) => index > 0 && name <= names[index - 1]!))
		fail(`${label} must be unique and sorted`);
	return Object.freeze(names);
}

export function linkReactionProjection(
	value: unknown,
): LinkedReactionProjection {
	const source = record(value, "artifact");
	exact(source, ["format", "version", "reactions"], "artifact");
	if (
		source.format !== "questpie.reaction-projection" ||
		source.version !== 2 ||
		!Array.isArray(source.reactions)
	)
		fail("artifact header is invalid");
	const members = new Map<string, LinkedReactionMember>();
	const byIdentity = new Map<string, LinkedReactionMember>();
	let previousIdentity: string | null = null;
	for (const [index, candidate] of source.reactions.entries()) {
		const reaction = record(candidate, `reaction ${index}`);
		exact(
			reaction,
			[
				"identity",
				"input",
				"output",
				"declaredErrors",
				"runAs",
				"retry",
				"effects",
				"contractDigest",
				"origin",
			],
			`reaction ${index}`,
		);
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
		const runAs = record(reaction.runAs, `reaction ${index} runAs`);
		exact(runAs, ["actor", "whenDenied"], `reaction ${index} runAs`);
		if (runAs.actor !== "caller" || runAs.whenDenied !== "fail")
			fail(`reaction ${index} runAs is outside the accepted recipe`);
		const linked = Object.freeze({
			identity,
			member,
			input: decodeRuntimeCodecDescriptor(
				reaction.input,
				`$reactionProjection.reactions[${index}].input`,
			),
			output: decodeRuntimeCodecDescriptor(
				reaction.output,
				`$reactionProjection.reactions[${index}].output`,
			),
			declaredErrors: linkDeclaredErrors(
				reaction.declaredErrors,
				`reaction ${index} declaredErrors`,
			),
			runAs: Object.freeze({
				actor: "caller" as const,
				whenDenied: "fail" as const,
			}),
			retry: linkRetry(reaction.retry, `reaction ${index} retry`),
			effects: linkEffects(reaction.effects, `reaction ${index} effects`),
			contractDigest: digestText(
				reaction.contractDigest,
				`reaction ${index} contractDigest`,
			),
		});
		if (members.has(member) || byIdentity.has(identity))
			fail(`reaction ${index} identity or member is duplicated`);
		members.set(member, linked);
		byIdentity.set(identity, linked);
	}
	return Object.freeze({ members, byIdentity });
}
