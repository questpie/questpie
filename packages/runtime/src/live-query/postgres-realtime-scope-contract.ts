import { principal, type Principal } from "questpie";

import { sha256Digest } from "../canonical-json";

const digestPattern = /^[0-9a-f]{64}$/;
const applicationIdentityPattern =
	/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;
const payloadBytesLimit = 1_048_576;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;

export type PostgresRealtimeScopeAuthority = Readonly<{
	applicationName: string;
	scopeIdentity: string;
	deploymentDigest: string;
	principal: Principal;
}>;

export type PostgresRealtimeOpenWatch = PostgresRealtimeScopeAuthority &
	Readonly<{
		bindingIdentity: string;
		authorityPartitionDigest: string;
		queryIdentity: string;
		queryBytes: Uint8Array;
		inputBytes: Uint8Array;
		inputDigest: string;
		contextInputBytes: Uint8Array;
		wireVersion: number;
	}>;

export type PostgresRealtimeGeneration = Readonly<{
	generation: bigint;
	tokenDigest: string;
	resultBytes: Uint8Array;
	dependencyPlanBytes: Uint8Array;
	delivery: "initial" | "reset" | "update";
	resetReason:
		| "authority-changed"
		| "deployment-changed"
		| "resume-unavailable"
		| null;
	acknowledged: boolean;
}>;

export type PostgresRealtimeWatch = Readonly<{
	bindingIdentity: string;
	authorityPartitionDigest: string;
	queryIdentity: string;
	queryBytes: Uint8Array;
	inputBytes: Uint8Array;
	inputDigest: string;
	contextInputBytes: Uint8Array;
	wireVersion: number;
	activeSlot: number;
	invalidationGeneration: bigint;
	evaluatedInvalidationGeneration: bigint;
	latest: PostgresRealtimeGeneration | null;
}>;

export type PostgresRealtimeGenerationStage = PostgresRealtimeScopeAuthority &
	Readonly<{
		bindingIdentity: string;
		observedInvalidationGeneration: bigint;
		generation: bigint;
		resumeToken: string;
		resultBytes: Uint8Array;
		dependencyPlanBytes: Uint8Array;
		delivery: PostgresRealtimeGeneration["delivery"];
		resetReason: PostgresRealtimeGeneration["resetReason"];
	}>;

export type PostgresRealtimeAcknowledgement = PostgresRealtimeScopeAuthority &
	Readonly<{
		bindingIdentity: string;
		generation: bigint;
		resumeToken: string;
	}>;

export function validDigest(value: string, label: string): string {
	if (!digestPattern.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

export function validBoundedIdentity(value: string, label: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 256 ||
		Buffer.byteLength(value) > 1_024
	)
		throw new TypeError(`${label} is invalid`);
	return value;
}

export function validateApplicationIdentity(value: string): void {
	if (!applicationIdentityPattern.test(value) || Buffer.byteLength(value) > 256)
		throw new TypeError("application identity is invalid");
}

export function validateScope(input: PostgresRealtimeScopeAuthority): void {
	validateApplicationIdentity(input.applicationName);
	validBoundedIdentity(input.scopeIdentity, "scope identity");
	validDigest(input.deploymentDigest, "deployment digest");
	if (!principal.is(input.principal))
		throw new TypeError("Principal is invalid");
	if (
		input.principal.id.length === 0 ||
		input.principal.id.length > 1_024 ||
		Buffer.byteLength(input.principal.id) > 4_096
	)
		throw new TypeError("Principal identity is invalid");
}

export function validateOpen(input: PostgresRealtimeOpenWatch): void {
	validateScope(input);
	validBoundedIdentity(input.bindingIdentity, "binding identity");
	validDigest(input.authorityPartitionDigest, "authority partition digest");
	validDigest(input.inputDigest, "input digest");
	validBoundedIdentity(input.queryIdentity, "Query identity");
	if (!Number.isSafeInteger(input.wireVersion) || input.wireVersion <= 0)
		throw new TypeError("wire version is invalid");
	for (const [value, label] of [
		[input.queryBytes, "Query bytes"],
		[input.inputBytes, "input bytes"],
		[input.contextInputBytes, "Context input bytes"],
	] as const)
		if (!(value instanceof Uint8Array))
			throw new TypeError(`${label} are invalid`);
	if (
		input.queryBytes.byteLength +
			input.inputBytes.byteLength +
			input.contextInputBytes.byteLength >
		payloadBytesLimit
	)
		throw new TypeError("realtime watch payload byte limit exceeded");
	if (sha256Digest(input.inputBytes) !== input.inputDigest)
		throw new TypeError("input digest does not bind the canonical input bytes");
}

export function validateGeneration(value: bigint): void {
	if (typeof value !== "bigint" || value <= 0n || value > postgresBigintMaximum)
		throw new TypeError("acknowledged generation is invalid");
}

export function validateResumeToken(value: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		Buffer.byteLength(value) > 4_096
	)
		throw new TypeError("resume token is invalid");
	return value;
}

export function validateCompleteGeneration(
	input: PostgresRealtimeGenerationStage,
): void {
	validateGeneration(input.observedInvalidationGeneration);
	validateGeneration(input.generation);
	validateResumeToken(input.resumeToken);
	if (!(input.resultBytes instanceof Uint8Array))
		throw new TypeError("result bytes are invalid");
	if (input.resultBytes.byteLength > payloadBytesLimit)
		throw new TypeError("result byte limit exceeded");
	if (!(input.dependencyPlanBytes instanceof Uint8Array))
		throw new TypeError("dependency plan bytes are invalid");
	if (input.dependencyPlanBytes.byteLength > 262_144)
		throw new TypeError("dependency plan byte limit exceeded");
	if (!(["initial", "reset", "update"] as const).includes(input.delivery))
		throw new TypeError("delivery kind is invalid");
	if (
		(input.delivery === "reset" &&
			!(
				[
					"authority-changed",
					"deployment-changed",
					"resume-unavailable",
				] as const
			).includes(input.resetReason!)) ||
		(input.delivery !== "reset" && input.resetReason !== null)
	)
		throw new TypeError("reset reason is invalid");
}

export function scopeLockIdentity(
	input: PostgresRealtimeScopeAuthority,
): string {
	return `questpie-realtime-scope-v1:${input.applicationName}:${input.deploymentDigest}:${input.principal.kind}:${input.principal.id}`;
}
