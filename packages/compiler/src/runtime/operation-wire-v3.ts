import { canonicalBytes, compareAscii, digest } from "../canonical";

type JsonRecord = Readonly<Record<string, unknown>>;

const ordinaryRequestKeys = [
	"application",
	"callId",
	"clientContractDigest",
	"context",
	"input",
	"operation",
	"protocol",
	"timeoutMilliseconds",
	"wireDigest",
] as const;

const actionRequestKeys = [...ordinaryRequestKeys, "effectKey"].sort(
	compareAscii,
);

const v2Keys = [
	"application",
	"callIdentity",
	"clientContractDigest",
	"committedResultUnavailable",
	"compatibility",
	"digest",
	"failureDetails",
	"failures",
	"format",
	"limits",
	"mediaType",
	"mutationAutomaticRetry",
	"operations",
	"path",
	"principalSource",
	"protocol",
	"requestKeys",
	"responseKeys",
	"resultKinds",
	"transactionIdentity",
	"version",
] as const;

const v2Failures = [
	"APPLICATION_MISMATCH",
	"CLIENT_OUTDATED",
	"COMMITTED_RESULT_UNAVAILABLE",
	"DEADLINE_EXCEEDED",
	"INTERNAL",
	"NOT_FOUND",
	"PROTOCOL_UNSUPPORTED",
	"RESOURCE_LIMIT",
	"RUNTIME_UNAVAILABLE",
] as const;

const qualifiedResourceName = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u;

function fail(message: string): never {
	throw new TypeError(
		`Invalid private Operation Wire v3 projection: ${message}`,
	);
}

function record(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		fail(`${label} must be an object`);
	return value as JsonRecord;
}

function exactKeys(value: JsonRecord, keys: readonly string[], label: string) {
	const actual = Object.keys(value).sort(compareAscii);
	const expected = [...keys].sort(compareAscii);
	if (
		actual.length !== expected.length ||
		expected.some((key, index) => key !== actual[index])
	)
		fail(`${label} keys are not exact`);
}

function exact(value: unknown, expected: unknown, label: string) {
	if (canonicalBytes(value) !== canonicalBytes(expected))
		fail(`${label} changed`);
}

function identity(value: unknown, kind: "action" | "mutation" | "query") {
	if (typeof value !== "string" || !value.startsWith(`${kind}:`))
		fail(
			`${kind === "action" ? "Action operation" : "retained operation"} identity is invalid`,
		);
	const name = value.slice(kind.length + 1);
	const segments = name.split(".");
	if (
		!qualifiedResourceName.test(name) ||
		name.length > 255 ||
		segments.some((segment) => segment.length > 63) ||
		(kind === "action" && segments.at(-1) === "then")
	)
		fail(
			`${kind === "action" ? "Action operation" : "retained operation"} identity is invalid`,
		);
	return value;
}

function operationIdentity(value: unknown): string {
	if (typeof value !== "string") fail("retained operation identity is invalid");
	for (const kind of ["mutation", "query"] as const)
		if (value.startsWith(`${kind}:`)) return identity(value, kind);
	fail("retained operation identity is invalid");
}

function validateRetainedV2(value: unknown): JsonRecord {
	const retained = record(value, "retained Wire v2");
	exactKeys(retained, v2Keys, "retained Wire v2");
	if (retained.format !== "questpie.operation-wire" || retained.version !== 2)
		fail("retained Wire v2 discriminator is invalid");
	exact(retained.requestKeys, ordinaryRequestKeys, "retained request keys");
	exact(retained.failures, v2Failures, "retained failure identities");
	const operations = retained.operations;
	if (!Array.isArray(operations)) fail("retained operations are invalid");
	let previous: string | undefined;
	for (const member of operations) {
		const operation = record(member, "retained operation");
		const current = operationIdentity(operation.identity);
		if (previous !== undefined && compareAscii(previous, current) >= 0)
			fail("retained operations are not globally ASCII-sorted");
		previous = current;
	}
	const unsigned = { ...retained };
	delete unsigned.digest;
	if (retained.digest !== digest("questpie-operation-wire-v2", unsigned))
		fail("retained Wire v2 digest is invalid");
	const compatibility = record(
		retained.compatibility,
		"retained compatibility",
	);
	exactKeys(
		compatibility,
		[
			"clientContractDigest",
			"wireV1Digest",
			"wireV1Source",
			"wireV1MutationExecution",
			"wireV1QueryExecution",
			"wireV1RejectionCode",
		],
		"retained compatibility",
	);
	if (
		compatibility.clientContractDigest !== retained.clientContractDigest ||
		compatibility.wireV1Source !==
			"sameApplicationClientContractAndOperations" ||
		compatibility.wireV1MutationExecution !==
			"rejectBeforeContextAndOperation" ||
		compatibility.wireV1QueryExecution !== "allowed" ||
		compatibility.wireV1RejectionCode !== "CLIENT_OUTDATED"
	)
		fail("retained Wire v1 pair semantics are invalid");
	const {
		callIdentity: _callIdentity,
		committedResultUnavailable: _committed,
		compatibility: _compatibility,
		digest: _digest,
		failureDetails: _failureDetails,
		resultKinds: _resultKinds,
		transactionIdentity: _transactionIdentity,
		...shared
	} = retained;
	const siblingV1 = {
		...shared,
		version: 1,
		clientContractDigest: compatibility.clientContractDigest,
		failures: (retained.failures as readonly unknown[]).filter(
			(code) => code !== "COMMITTED_RESULT_UNAVAILABLE",
		),
	};
	if (
		compatibility.wireV1Digest !==
		digest("questpie-operation-wire-v1", siblingV1)
	)
		fail("retained Wire v1 sibling digest is invalid");
	return retained;
}

function actionContract(value: unknown): JsonRecord {
	const action = record(value, "Action operation");
	exactKeys(
		action,
		["declaredErrors", "identity", "input", "output"],
		"Action operation",
	);
	identity(action.identity, "action");
	record(action.input, "Action input codec");
	record(action.output, "Action output codec");
	record(action.declaredErrors, "Action declared errors");
	return structuredClone(action);
}

function extension(action: JsonRecord) {
	return {
		actionEffectIdentity: {
			automaticRetry: false,
			callerMaterial: "effectKey",
			derivationDomain: "questpie.effect-identity.action.v1",
			derivationFields: [
				"application",
				"tenant",
				"principalKind",
				"principalId",
				"action",
				"effectKey",
			],
			domainInputExcluded: true,
			handlerAccess: "effect.id",
			internalFormat: "uuid",
			mutationCallIdExcluded: true,
			wireDisclosure: false,
		},
		actionFailureDetails: {
			actionOutcomeAmbiguous: ["code", "retryable"],
			postHandlerResourceLimit: [
				"code",
				"doesNotClassifyProviderOutcome",
				"phase",
				"provesProviderNonacceptance",
				"replayAuthorized",
				"retryable",
			],
		},
		actionFailures: [...v2Failures, "ACTION_OUTCOME_AMBIGUOUS"].sort(
			compareAscii,
		),
		actionLimitsProjection: {
			fields: ["durationMilliseconds", "inputBytes", "resultBytes"],
			semanticCanonicalJsonLineBytes: true,
			transportLimitsDistinct: true,
		},
		actionOutcomeAmbiguous: {
			authoredOutcomeUnknownDistinct: true,
			automaticRetry: false,
			code: "ACTION_OUTCOME_AMBIGUOUS",
			payload: ["callId"],
			retryable: false,
			triggers: [
				"fetchRejectedAfterDispatch",
				"responseLostAfterDispatch",
				"cancellationRaceAfterDispatch",
				"malformedContentTypeAfterDispatch",
				"invalidJsonAfterDispatch",
				"unknownFrameAfterDispatch",
				"miscorrelatedFrameAfterDispatch",
				"connectionTruncatedAfterDispatch",
			],
		},
		actionRequestKeys,
		effectKey: {
			absenceBehavior: "reject",
			equality: "exactUtf8AfterValidation",
			kind: "text",
			loneSurrogates: "forbidden",
			maximumUnicodeScalars: 256,
			maximumUtf8Bytes: 1_024,
			minimumUnicodeScalars: 1,
			normalization: "NFC",
			normalizationBehavior: "rejectNotRewrite",
			nullScalar: "forbidden",
			required: true,
		},
		postDispatchResourceLimit: {
			automaticRetry: false,
			code: "RESOURCE_LIMIT",
			doesNotClassifyProviderOutcome: true,
			phase: "postHandler",
			provesProviderNonacceptance: false,
			replayAuthorized: false,
			retryable: false,
		},
		preExecutionRejection: {
			code: "CLIENT_OUTDATED",
			frameKind: "failure",
			providerCalls: 0,
			retryable: false,
		},
		action,
	};
}

function freezeDeep<Value>(value: Value): Value {
	if (value && typeof value === "object") {
		for (const member of Object.values(value)) freezeDeep(member);
		Object.freeze(value);
	}
	return value;
}

export function projectOperationWireV3(
	input: Readonly<{
		retainedWireV2: unknown;
		actionOperation: unknown;
	}>,
): Readonly<Record<string, unknown>> {
	const retained = validateRetainedV2(input.retainedWireV2);
	const action = actionContract(input.actionOperation);
	const actionIdentity = action.identity as string;
	const retainedOperations = retained.operations as readonly JsonRecord[];
	if (retainedOperations.some((member) => member.identity === actionIdentity))
		fail("Action operation collides with a retained operation");
	const projectedExtension = extension(action);
	const operations = [...retainedOperations, action].sort((left, right) =>
		compareAscii(String(left.identity), String(right.identity)),
	);
	const compatibility = record(
		retained.compatibility,
		"retained compatibility",
	);
	const unsigned: Record<string, unknown> = {
		...retained,
		version: 3,
		compatibility: {
			...compatibility,
			wireV2Digest: retained.digest,
			wireV2ActionExecution: "rejectBeforeContextServiceAndHandler",
			wireV2MutationExecution: "allowed",
			wireV2QueryExecution: "allowed",
		},
		...projectedExtension,
		operations,
	};
	delete unsigned.action;
	delete unsigned.digest;
	return freezeDeep({
		...unsigned,
		digest: digest("questpie-operation-wire-v3", unsigned),
	});
}
