import { createHash } from "node:crypto";

import { actionDeadline, type ActionLimits } from "../action-limits/contract";

export const effectKeyContract = Object.freeze({
	kind: "text",
	minimumUnicodeScalars: 1,
	maximumUnicodeScalars: 256,
	maximumUtf8Bytes: 1_024,
	normalization: "NFC",
	normalizationBehavior: "rejectNotRewrite",
	loneSurrogates: "forbidden",
	nullScalar: "forbidden",
	required: true,
	absenceBehavior: "reject",
	equality: "exactUtf8AfterValidation",
} as const);

export type EffectScope = Readonly<{
	application: `application:${string}`;
	tenant: string;
	principal: Readonly<{ kind: "anonymous" | "service" | "user"; id: string }>;
	action: `action:${string}`;
	effectKey: string;
}>;

export type ActionCallerOptions = Readonly<{
	effectKey: string;
	callId?: string;
	timeoutMilliseconds?: number;
}>;

export type ActionHandlerFacts = Readonly<{ effect: Readonly<{ id: string }> }>;

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(domain)
		.update("\0")
		.update(`${canonical(value)}\n`)
		.digest("hex");
}

function deterministicUuidFromDigest(hash: string): string {
	return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function legacyDurableUuid(value: unknown): string {
	const hash = createHash("sha256")
		.update(`${canonical(value)}\n`)
		.digest("hex");
	return deterministicUuidFromDigest(hash);
}

function unicodeScalars(value: string): number {
	return [...value].length;
}

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff)
				return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

export function isEffectKey(value: unknown): value is string {
	return (
		typeof value === "string" &&
		unicodeScalars(value) >= effectKeyContract.minimumUnicodeScalars &&
		unicodeScalars(value) <= effectKeyContract.maximumUnicodeScalars &&
		Buffer.byteLength(value, "utf8") <= effectKeyContract.maximumUtf8Bytes &&
		!value.includes("\0") &&
		!hasLoneSurrogate(value) &&
		value.normalize("NFC") === value
	);
}

function ownerIdentity(value: unknown, prefix: string, label: string): string {
	const qualifiedResourceName = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u;
	if (typeof value !== "string" || !value.startsWith(`${prefix}:`))
		throw new TypeError(
			`${label} is not a canonical ${prefix} Resource Identity`,
		);
	const name = value.slice(prefix.length + 1);
	const segments = name.split(".");
	if (
		!qualifiedResourceName.test(name) ||
		name.length > 255 ||
		segments.some((segment) => segment.length > 63) ||
		(prefix === "action" && segments.at(-1) === "then")
	)
		throw new TypeError(
			`${label} is not a canonical ${prefix} Resource Identity`,
		);
	return value;
}

function trustedFactText(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.includes("\0") ||
		hasLoneSurrogate(value) ||
		value.normalize("NFC") !== value
	)
		throw new TypeError(`${label} is invalid`);
	return value;
}

export function deriveEffectIdentity(scope: EffectScope): string {
	const application = ownerIdentity(
		scope.application,
		"application",
		"application",
	);
	const action = ownerIdentity(scope.action, "action", "Action identity");
	if (!isEffectKey(scope.effectKey))
		throw new TypeError("effectKey is invalid");
	trustedFactText(scope.tenant, "tenant");
	trustedFactText(scope.principal.id, "principal id");
	if (!["anonymous", "service", "user"].includes(scope.principal.kind))
		throw new TypeError("principal kind is invalid");
	const hash = digest("questpie.effect-identity.action.v1", {
		action,
		application,
		effectKey: scope.effectKey,
		principalId: scope.principal.id,
		principalKind: scope.principal.kind,
		tenant: scope.tenant,
	});
	return deterministicUuidFromDigest(hash);
}

/** Preserves the Accepted durable ledger vector and UUID storage grammar. */
export function deriveDurableEffectIdentity(
	application: string,
	runId: string,
	effectName: string,
): string {
	return legacyDurableUuid({ application, effectName, runId });
}

export class ActionOutcomeAmbiguous extends Error {
	readonly code = "ACTION_OUTCOME_AMBIGUOUS";
	readonly retryable = false;
	constructor(readonly payload: Readonly<{ callId: string }>) {
		super("Action outcome is ambiguous after dispatch");
		this.name = "ActionOutcomeAmbiguous";
	}
}

export class ActionPostDispatchResourceLimit extends Error {
	readonly code = "RESOURCE_LIMIT";
	readonly phase = "postHandler";
	readonly retryable = false;
	readonly provesProviderNonacceptance = false;
	readonly replayAuthorized = false;
	readonly doesNotClassifyProviderOutcome = true;
	constructor() {
		super("Action semantic payload exceeded a post-dispatch limit");
		this.name = "ActionPostDispatchResourceLimit";
	}
}

type ProviderOutcome =
	| "accepted"
	| "authoredResultDisclosure"
	| "authoredDeclaredErrorDisclosure"
	| "preExecutionRejected"
	| "rejected"
	| "outcomeUnknown"
	| "fetchRejected"
	| "responseLost"
	| "cancelledAfterDispatch"
	| "malformedContentType"
	| "invalidJson"
	| "unknownFrame"
	| "miscorrelatedFrame"
	| "connectionTruncated"
	| "resultPayloadOverflow"
	| "outcomeUnknownPayloadOverflow";

function containsForbiddenText(
	value: unknown,
	forbidden: ReadonlySet<string>,
): boolean {
	if (typeof value === "string")
		return [...forbidden].some((secret) => value.includes(secret));
	if (Array.isArray(value))
		return value.some((item) => containsForbiddenText(item, forbidden));
	if (!value || typeof value !== "object") return false;
	return Object.values(value).some((item) =>
		containsForbiddenText(item, forbidden),
	);
}

export function assertFrameworkOwnedOutcomeNondisclosure(
	frame: unknown,
	forbidden: readonly string[],
): void {
	if (!frame || typeof frame !== "object")
		throw new TypeError("outcome frame is invalid");
	const record = frame as Record<string, unknown>;
	let frameworkOwned: unknown = record;
	if (record.kind === "result") {
		const { payload: _authoredPayload, ...metadata } = record;
		frameworkOwned = metadata;
	} else if (record.kind === "declaredError") {
		if (!record.error || typeof record.error !== "object")
			throw new TypeError("declared error frame is invalid");
		const { payload: _authoredPayload, ...errorMetadata } =
			record.error as Record<string, unknown>;
		frameworkOwned = { ...record, error: errorMetadata };
	}
	if (containsForbiddenText(frameworkOwned, new Set(forbidden)))
		throw new TypeError("framework-owned outcome disclosed Effect material");
}

export function createActionHarness(
	input: Readonly<{
		carrier: "direct" | "network";
		limits?: ActionLimits;
		rootRemainingMilliseconds?: number | null;
		callerMonotonicNow?: () => number;
		runtimeMonotonicNow?: () => number;
	}>,
) {
	let providerCalls = 0;
	const observedEffectIds: string[] = [];
	const observedRemainingBudgets: number[] = [];
	const observedLocalDeadlines: number[] = [];
	const frames: unknown[] = [];
	const frameBytes: string[] = [];
	const limits = input.limits ?? {
		inputBytes: 1_024,
		resultBytes: 1_024,
		durationMilliseconds: 5_000,
	};
	const callerMonotonicNow =
		input.callerMonotonicNow ?? performance.now.bind(performance);
	const runtimeMonotonicNow =
		input.runtimeMonotonicNow ?? performance.now.bind(performance);
	return {
		get providerCalls() {
			return providerCalls;
		},
		get automaticRetries() {
			return 0;
		},
		observedEffectIds,
		observedRemainingBudgets,
		observedLocalDeadlines,
		frames,
		frameBytes,
		async invoke(
			invocation: EffectScope &
				Readonly<{
					callId: string;
					input: Readonly<Record<string, unknown>>;
					provider: ProviderOutcome;
					preDispatchCancellation?: unknown;
				}>,
		) {
			if ("preDispatchCancellation" in invocation)
				throw invocation.preDispatchCancellation;
			const callerStartedAt = callerMonotonicNow();
			const callerDeadline = actionDeadline(limits, {
				monotonicStartedAt: callerStartedAt,
				rootRemainingMilliseconds: input.rootRemainingMilliseconds ?? null,
			});
			const timeoutMilliseconds = callerDeadline - callerStartedAt;
			const request = {
				application: invocation.application,
				callId: invocation.callId,
				clientContractDigest: "retained-v2-client-contract",
				context: {},
				effectKey: invocation.effectKey,
				input: invocation.input,
				operation: invocation.action,
				protocol: { name: "questpie.operation", version: 1 },
				timeoutMilliseconds,
				wireDigest: "candidate-v3",
			};
			const roundTrip = <T>(value: T): T =>
				JSON.parse(JSON.stringify(value)) as T;
			const admitted =
				input.carrier === "network" ? roundTrip(request) : request;
			const expectedRequestKeys = [
				"application",
				"callId",
				"clientContractDigest",
				"context",
				"effectKey",
				"input",
				"operation",
				"protocol",
				"timeoutMilliseconds",
				"wireDigest",
			];
			if (
				canonical(Object.keys(admitted).sort()) !==
				canonical(expectedRequestKeys)
			)
				throw new TypeError("network server rejected non-exact Action request");
			const runtimeStartedAt = runtimeMonotonicNow();
			const localDeadline = actionDeadline(limits, {
				monotonicStartedAt: runtimeStartedAt,
				rootRemainingMilliseconds: admitted.timeoutMilliseconds,
			});
			observedRemainingBudgets.push(localDeadline - runtimeStartedAt);
			observedLocalDeadlines.push(localDeadline);
			const record = (frame: unknown, forbidden: readonly string[]) => {
				const decoded = input.carrier === "network" ? roundTrip(frame) : frame;
				const record = decoded as Record<string, unknown>;
				const expected =
					"callId" in record
						? record.kind === "result"
							? ["callId", "kind", "operation", "payload", "protocol"]
							: ["callId", "error", "kind", "operation", "protocol"]
						: ["error", "kind"];
				if (canonical(Object.keys(record).sort()) !== canonical(expected))
					throw new TypeError(
						"network client rejected non-exact outcome frame",
					);
				assertFrameworkOwnedOutcomeNondisclosure(decoded, forbidden);
				frames.push(decoded);
				frameBytes.push(`${canonical(decoded)}\n`);
			};
			if (invocation.provider === "preExecutionRejected") {
				record(
					{
						error: { code: "CLIENT_OUTDATED", retryable: false },
						kind: "failure",
					},
					[invocation.effectKey],
				);
				throw new Error("CLIENT_OUTDATED");
			}
			const effectId = deriveEffectIdentity({
				...invocation,
				effectKey: admitted.effectKey,
			});
			providerCalls += 1;
			observedEffectIds.push(effectId);
			if (invocation.provider === "authoredResultDisclosure") {
				const result = Object.freeze({ receipt: effectId });
				record(
					{
						callId: invocation.callId,
						kind: "result",
						operation: invocation.action,
						payload: result,
						protocol: { name: "questpie.operation", version: 1 },
					},
					[invocation.effectKey, effectId],
				);
				return result;
			}
			if (invocation.provider === "authoredDeclaredErrorDisclosure") {
				record(
					{
						callId: invocation.callId,
						error: {
							code: "OUTCOME_UNKNOWN",
							payload: { provider: effectId },
							status: 502,
						},
						kind: "declaredError",
						operation: invocation.action,
						protocol: { name: "questpie.operation", version: 1 },
					},
					[invocation.effectKey, effectId],
				);
				throw new Error("provider.authoredDisclosure");
			}
			if (invocation.provider === "rejected") {
				record(
					{
						callId: invocation.callId,
						error: { code: "PROVIDER_REJECTED", payload: null, status: 422 },
						kind: "declaredError",
						operation: invocation.action,
						protocol: { name: "questpie.operation", version: 1 },
					},
					[invocation.effectKey, effectId],
				);
				throw new Error("provider.rejected");
			}
			if (invocation.provider === "outcomeUnknown") {
				record(
					{
						callId: invocation.callId,
						error: {
							code: "OUTCOME_UNKNOWN",
							payload: { provider: "unknown" },
							status: 502,
						},
						kind: "declaredError",
						operation: invocation.action,
						protocol: { name: "questpie.operation", version: 1 },
					},
					[invocation.effectKey, effectId],
				);
				throw new Error("provider.outcomeUnknown");
			}
			if (
				invocation.provider === "resultPayloadOverflow" ||
				invocation.provider === "outcomeUnknownPayloadOverflow"
			) {
				record(
					{
						callId: invocation.callId,
						error: {
							code: "RESOURCE_LIMIT",
							doesNotClassifyProviderOutcome: true,
							phase: "postHandler",
							provesProviderNonacceptance: false,
							replayAuthorized: false,
							retryable: false,
						},
						kind: "failure",
						operation: invocation.action,
						protocol: { name: "questpie.operation", version: 1 },
					},
					[invocation.effectKey, effectId],
				);
				throw new ActionPostDispatchResourceLimit();
			}
			if (
				invocation.provider === "fetchRejected" ||
				invocation.provider === "responseLost" ||
				invocation.provider === "cancelledAfterDispatch" ||
				invocation.provider === "malformedContentType" ||
				invocation.provider === "invalidJson" ||
				invocation.provider === "unknownFrame" ||
				invocation.provider === "miscorrelatedFrame" ||
				invocation.provider === "connectionTruncated"
			) {
				const error = new ActionOutcomeAmbiguous({
					callId: invocation.callId,
				});
				throw error;
			}
			const result = Object.freeze({ receipt: "provider:accepted" });
			record(
				{
					callId: invocation.callId,
					kind: "result",
					operation: invocation.action,
					payload: result,
					protocol: { name: "questpie.operation", version: 1 },
				},
				[invocation.effectKey, effectId],
			);
			return result;
		},
	};
}

export function projectWireV3(
	retainedV2: Readonly<Record<string, unknown>>,
	extension: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	const retainedUnsigned = { ...retainedV2 };
	delete retainedUnsigned.digest;
	if (
		retainedV2.digest !== digest("questpie-operation-wire-v2", retainedUnsigned)
	)
		throw new TypeError("retained Wire v2 digest is invalid");
	const allowed = [
		"actionEffectIdentity",
		"actionFailureDetails",
		"actionFailures",
		"actionLimitsProjection",
		"actionOperation",
		"actionOutcomeAmbiguous",
		"actionRequestKeys",
		"effectKey",
		"postDispatchResourceLimit",
		"preExecutionRejection",
	];
	if (Object.keys(extension).sort().join("\0") !== allowed.join("\0"))
		throw new TypeError("Wire v3 extension is not closed");
	const action = extension.actionOperation as Record<string, unknown>;
	const operations = [
		...(retainedV2.operations as readonly Record<string, unknown>[]),
		action,
	].sort((left, right) =>
		String(left.identity) < String(right.identity)
			? -1
			: String(left.identity) > String(right.identity)
				? 1
				: 0,
	);
	const actionFailures = [
		...(extension.actionFailures as readonly string[]),
	].sort();
	const unsigned = {
		...retainedV2,
		version: 3,
		compatibility: {
			...(retainedV2.compatibility as object),
			wireV2Digest: retainedV2.digest,
			wireV2ActionExecution: "rejectBeforeContextServiceAndHandler",
			wireV2MutationExecution: "allowed",
			wireV2QueryExecution: "allowed",
		},
		...extension,
		actionFailures,
		operations,
	};
	delete (unsigned as Record<string, unknown>).actionOperation;
	delete (unsigned as Record<string, unknown>).digest;
	return Object.freeze({
		...unsigned,
		digest: digest("questpie-operation-wire-v3", unsigned),
	});
}

export function signWireV3ForHostile(value: Readonly<Record<string, unknown>>) {
	const unsigned = { ...value };
	delete unsigned.digest;
	return Object.freeze({
		...unsigned,
		digest: digest("questpie-operation-wire-v3", unsigned),
	});
}

function exactMembers(
	actual: unknown,
	expected: readonly string[],
	label: string,
) {
	if (
		!Array.isArray(actual) ||
		actual.some((member) => typeof member !== "string") ||
		canonical(actual) !== canonical([...expected].sort())
	)
		throw new TypeError(`${label} is not exact`);
}

export function validateWireV3(
	value: unknown,
	retainedV2: Readonly<Record<string, unknown>>,
	extension: Readonly<Record<string, unknown>>,
): Readonly<{ digest: string }> {
	if (!value || typeof value !== "object")
		throw new TypeError("wire is not an object");
	const wire = value as Record<string, unknown>;
	const claimed = wire.digest;
	const unsigned = { ...wire };
	delete unsigned.digest;
	const actual = digest("questpie-operation-wire-v3", unsigned);
	if (claimed !== actual)
		throw new TypeError(`wire digest mismatch: ${actual}`);
	if (wire.format !== "questpie.operation-wire" || wire.version !== 3)
		throw new TypeError("wire v3 discriminator is invalid");
	for (const [key, retained] of Object.entries(retainedV2)) {
		if (["compatibility", "digest", "operations", "version"].includes(key))
			continue;
		if (canonical(wire[key]) !== canonical(retained))
			throw new TypeError(`Wire v3 changed retained v2 field ${key}`);
	}
	const compatibility = wire.compatibility as
		| Record<string, unknown>
		| undefined;
	if (
		compatibility?.wireV2Digest !== retainedV2.digest ||
		compatibility?.wireV2ActionExecution !==
			"rejectBeforeContextServiceAndHandler" ||
		compatibility?.wireV2MutationExecution !== "allowed" ||
		compatibility?.wireV2QueryExecution !== "allowed"
	)
		throw new TypeError("Wire v3 retained-pair compatibility is invalid");
	const requiredCompatibility = compatibility!;
	const retainedCompatibility = retainedV2.compatibility as Record<
		string,
		unknown
	>;
	for (const [key, retained] of Object.entries(retainedCompatibility))
		if (canonical(requiredCompatibility[key]) !== canonical(retained))
			throw new TypeError(`Wire v3 changed retained compatibility ${key}`);
	const retainedOperations = retainedV2.operations as readonly Record<
		string,
		unknown
	>[];
	const operations = wire.operations as
		| readonly Record<string, unknown>[]
		| undefined;
	if (
		!operations ||
		canonical(
			operations.filter((operation) =>
				retainedOperations.some(
					(retained) => retained.identity === operation.identity,
				),
			),
		) !== canonical(retainedOperations) ||
		operations.length !== retainedOperations.length + 1 ||
		operations.some(
			(operation, index) =>
				index > 0 &&
				String(operations[index - 1]!.identity) >= String(operation.identity),
		)
	)
		throw new TypeError("Wire v3 did not add exactly one Action operation");
	const retainedRequestKeys = retainedV2.requestKeys as readonly string[];
	exactMembers(wire.requestKeys, retainedRequestKeys, "retained requestKeys");
	exactMembers(
		wire.actionRequestKeys,
		[...retainedRequestKeys, "effectKey"].sort(),
		"Action requestKeys",
	);
	const identity = wire.actionEffectIdentity as
		| Record<string, unknown>
		| undefined;
	if (
		identity?.callerMaterial !== "effectKey" ||
		identity.internalFormat !== "uuid" ||
		identity.domainInputExcluded !== true ||
		identity.mutationCallIdExcluded !== true ||
		identity.wireDisclosure !== false ||
		identity.automaticRetry !== false
	)
		throw new TypeError("wire Effect Identity ownership is invalid");
	const ambiguous = wire.actionOutcomeAmbiguous as
		| Record<string, unknown>
		| undefined;
	if (
		ambiguous?.code !== "ACTION_OUTCOME_AMBIGUOUS" ||
		ambiguous.retryable !== false ||
		ambiguous.automaticRetry !== false ||
		ambiguous.authoredOutcomeUnknownDistinct !== true
	)
		throw new TypeError("wire ambiguity ownership is invalid");
	exactMembers(
		wire.actionFailures,
		[
			...(retainedV2.failures as readonly string[]),
			"ACTION_OUTCOME_AMBIGUOUS",
		].sort(),
		"Action failures",
	);
	if (
		canonical(wire.actionFailureDetails) !==
		canonical({
			actionOutcomeAmbiguous: ["code", "retryable"],
			postHandlerResourceLimit: [
				"code",
				"doesNotClassifyProviderOutcome",
				"phase",
				"provesProviderNonacceptance",
				"replayAuthorized",
				"retryable",
			],
		})
	)
		throw new TypeError("Action failure details are invalid");
	if (canonical(wire.effectKey) !== canonical(effectKeyContract))
		throw new TypeError("wire effectKey grammar is invalid");
	if (canonical(wire) !== canonical(projectWireV3(retainedV2, extension)))
		throw new TypeError("Wire v3 artifact is not the exact closed projection");
	return Object.freeze({ digest: actual });
}

export function admitOperationRequest(
	input: Readonly<{
		version: 1 | 2 | 3;
		operation: string;
		request: Readonly<Record<string, unknown>>;
		wireV3: Readonly<Record<string, unknown>>;
		enterContext(): void;
		createService(): void;
		enterHandler(): void;
	}>,
): "accepted" | "CLIENT_OUTDATED" {
	const requestedOperation = input.request.operation;
	if (typeof requestedOperation !== "string")
		throw new TypeError("request operation is invalid");
	if (requestedOperation !== input.operation) {
		if (
			input.version < 3 &&
			(requestedOperation.startsWith("action:") ||
				input.operation.startsWith("action:"))
		)
			return "CLIENT_OUTDATED";
		throw new TypeError(
			"request operation does not match the selected operation",
		);
	}
	if (input.operation.startsWith("action:") && input.version < 3)
		return "CLIENT_OUTDATED";
	if (input.operation.startsWith("mutation:") && input.version === 1)
		return "CLIENT_OUTDATED";
	const expected = input.operation.startsWith("action:")
		? (input.wireV3.actionRequestKeys as readonly string[])
		: (input.wireV3.requestKeys as readonly string[]);
	const keys = Object.keys(input.request).sort();
	if (canonical(keys) !== canonical([...expected].sort()))
		throw new TypeError("request keys are not exact for Operation kind");
	input.enterContext();
	input.createService();
	input.enterHandler();
	return "accepted";
}
