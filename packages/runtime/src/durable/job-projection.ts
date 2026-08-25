import { decodeRuntimeCodecDescriptor, type RuntimeCodec } from "../codec";
import type { LinkedDeclaredError, LinkedReactionRetry } from "./projection";

type RecordValue = Readonly<Record<string, unknown>>;

export type LinkedJobMember = Readonly<{
	identity: string;
	member: string;
	semanticVersion: number;
	input: RuntimeCodec;
	output: RuntimeCodec;
	declaredErrors: Readonly<Record<string, LinkedDeclaredError>>;
	runAs: Readonly<{ actor: "caller"; whenDenied: "fail" }>;
	retry: LinkedReactionRetry;
	contractDigest: string;
}>;

export type LinkedJobProjection = Readonly<{
	members: ReadonlyMap<string, LinkedJobMember>;
	byIdentity: ReadonlyMap<string, LinkedJobMember>;
}>;

function fail(message: string): never {
	throw new TypeError(`Invalid Job projection: ${message}`);
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

function text(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		fail(`${label} is invalid`);
	return value;
}

function integer(
	value: unknown,
	label: string,
	minimum: number,
	maximum: number,
) {
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	)
		fail(`${label} is outside ${minimum}..${maximum}`);
	return value;
}

function retry(value: unknown, label: string): LinkedReactionRetry {
	const item = record(value, label);
	exact(
		item,
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
	if (item.backoff !== "exponential" || item.jitter !== "full")
		fail(`${label} is outside the accepted retry program`);
	const initialDelayMilliseconds = integer(
		item.initialDelayMilliseconds,
		`${label}.initialDelayMilliseconds`,
		1,
		900_000,
	);
	const maximumDelayMilliseconds = integer(
		item.maximumDelayMilliseconds,
		`${label}.maximumDelayMilliseconds`,
		initialDelayMilliseconds,
		900_000,
	);
	return Object.freeze({
		maximumAttempts: integer(
			item.maximumAttempts,
			`${label}.maximumAttempts`,
			1,
			8,
		),
		initialDelayMilliseconds,
		backoff: "exponential" as const,
		maximumDelayMilliseconds,
		jitter: "full" as const,
		horizonMilliseconds: integer(
			item.horizonMilliseconds,
			`${label}.horizonMilliseconds`,
			maximumDelayMilliseconds,
			86_400_000,
		),
	});
}

function declaredErrors(
	value: unknown,
	label: string,
): Readonly<Record<string, LinkedDeclaredError>> {
	return Object.freeze(
		Object.fromEntries(
			Object.entries(record(value, label)).map(([key, candidate]) => {
				const declared = record(candidate, `${label}.${key}`);
				exact(declared, ["code", "status", "payload"], `${label}.${key}`);
				return [
					key,
					Object.freeze({
						code: text(declared.code, `${label}.${key}.code`),
						status: integer(
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

export function linkJobProjection(value: unknown): LinkedJobProjection {
	const source = record(value, "artifact");
	exact(source, ["format", "version", "jobs"], "artifact");
	if (
		source.format !== "questpie.job-projection" ||
		source.version !== 1 ||
		!Array.isArray(source.jobs)
	)
		fail("artifact header is invalid");
	const members = new Map<string, LinkedJobMember>();
	const byIdentity = new Map<string, LinkedJobMember>();
	let previousIdentity: string | null = null;
	for (const [index, candidate] of source.jobs.entries()) {
		const job = record(candidate, `job ${index}`);
		exact(
			job,
			[
				"identity",
				"semanticVersion",
				"input",
				"output",
				"declaredErrors",
				"runAs",
				"retry",
				"signals",
				"schedule",
				"contractDigest",
				"origin",
			],
			`job ${index}`,
		);
		const identity = text(job.identity, `job ${index} identity`);
		if (!identity.startsWith("job:") || identity.length === 4)
			fail(`job ${index} identity is invalid`);
		if (previousIdentity !== null && identity <= previousIdentity)
			fail("jobs must be unique and identity-sorted");
		previousIdentity = identity;
		const member = identity.slice(4);
		if (member.includes(":")) fail(`job ${index} identity is invalid`);
		const origin = record(job.origin, `job ${index} origin`);
		exact(origin, ["path", "exportName", "packageId"], `job ${index} origin`);
		text(origin.path, `job ${index} origin path`);
		text(origin.exportName, `job ${index} origin exportName`);
		if (origin.packageId !== null)
			text(origin.packageId, `job ${index} origin packageId`);
		const runAs = record(job.runAs, `job ${index} runAs`);
		exact(runAs, ["actor", "whenDenied"], `job ${index} runAs`);
		if (runAs.actor !== "caller" || runAs.whenDenied !== "fail")
			fail(`job ${index} runAs is outside the accepted recipe`);
		if (
			job.schedule !== null ||
			!job.signals ||
			typeof job.signals !== "object" ||
			Array.isArray(job.signals) ||
			Object.keys(job.signals).length !== 0
		)
			fail(`job ${index} uses deferred scheduling or signals`);
		const digest = text(job.contractDigest, `job ${index} contractDigest`);
		if (!/^[0-9a-f]{64}$/.test(digest))
			fail(`job ${index} contractDigest is not a SHA-256 digest`);
		const linked = Object.freeze({
			identity,
			member,
			semanticVersion: integer(
				job.semanticVersion,
				`job ${index} semanticVersion`,
				1,
				Number.MAX_SAFE_INTEGER,
			),
			input: decodeRuntimeCodecDescriptor(
				job.input,
				`$jobProjection.jobs[${index}].input`,
			),
			output: decodeRuntimeCodecDescriptor(
				job.output,
				`$jobProjection.jobs[${index}].output`,
			),
			declaredErrors: declaredErrors(
				job.declaredErrors,
				`job ${index} declaredErrors`,
			),
			runAs: Object.freeze({
				actor: "caller" as const,
				whenDenied: "fail" as const,
			}),
			retry: retry(job.retry, `job ${index} retry`),
			contractDigest: digest,
		});
		if (members.has(member) || byIdentity.has(identity))
			fail(`job ${index} identity or member is duplicated`);
		members.set(member, linked);
		byIdentity.set(identity, linked);
	}
	return Object.freeze({ members, byIdentity });
}
