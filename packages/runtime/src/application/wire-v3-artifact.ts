import { isOperationCallId } from "../operation/call-identity";
import {
	exactRuntimeArtifactKeys as exactKeys,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as digest,
	runtimeArtifactRecord as record,
} from "./artifact-protocol";
import { validateOperationWireV2 } from "./wire-v2-artifact";
import {
	validatePrivateActionOperation,
	validatePrivateRetainedWireV2,
} from "./wire-v3-contract-validation";

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

const actionRequestKeys = [
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
] as const;

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

const v3ExtensionKeys = [
	"actionEffectIdentity",
	"actionFailureDetails",
	"actionFailures",
	"actionLimitsProjection",
	"actionOutcomeAmbiguous",
	"actionRequestKeys",
	"effectKey",
	"postDispatchResourceLimit",
	"preExecutionRejection",
] as const;

const v3Keys = [
	...v2Keys.filter((key) => key !== "compatibility" && key !== "digest"),
	"compatibility",
	...v3ExtensionKeys,
	"digest",
] as const;

function exact(value: unknown, expected: unknown, label: string) {
	if (
		digest("questpie.private-wire-v3-exact", value) !==
		digest("questpie.private-wire-v3-exact", expected)
	)
		fail(`${label} changed`);
}

function validateRetainedV2(value: unknown): JsonRecord {
	const retained = record(value, "retained Wire v2");
	exactKeys(retained, v2Keys, "retained Wire v2");
	if (retained.format !== "questpie.operation-wire" || retained.version !== 2)
		fail("retained Wire v2 discriminator is invalid");
	validatePrivateRetainedWireV2(retained);
	validateOperationWireV2(retained);
	const unsigned = { ...retained };
	delete unsigned.digest;
	if (retained.digest !== digest("questpie-operation-wire-v2", unsigned))
		fail("retained Wire v2 digest does not match");
	return retained;
}

function actionOperation(value: unknown): JsonRecord {
	return validatePrivateActionOperation(value);
}

function fixedExtension() {
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
		actionFailures: [...v2Failures, "ACTION_OUTCOME_AMBIGUOUS"].sort(),
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
	};
}

function expectedWire(
	retained: JsonRecord,
	actions: readonly JsonRecord[],
): Readonly<Record<string, unknown>> {
	const operations = [
		...(retained.operations as readonly JsonRecord[]),
		...actions,
	].sort((left, right) =>
		String(left.identity) < String(right.identity)
			? -1
			: String(left.identity) > String(right.identity)
				? 1
				: 0,
	);
	const unsigned: Record<string, unknown> = {
		...retained,
		version: 3,
		compatibility: {
			...(retained.compatibility as object),
			wireV2Digest: retained.digest,
			wireV2ActionExecution: "rejectBeforeContextServiceAndHandler",
			wireV2MutationExecution: "allowed",
			wireV2QueryExecution: "allowed",
		},
		...fixedExtension(),
		operations,
	};
	delete unsigned.digest;
	return {
		...unsigned,
		digest: digest("questpie-operation-wire-v3", unsigned),
	};
}

type Pair = Readonly<{
	clientContractDigest: string;
	wireDigest: string;
}>;

export type OperationWireV3Validation = Readonly<{
	digest: string;
	pairs: Readonly<{
		currentV3: Pair;
		retainedV2: Pair;
		retainedV1: Pair;
	}>;
}>;

export function validateOperationWireV3(
	input: Readonly<{
		wire: unknown;
		retainedWireV2: unknown;
		actionOperation?: unknown;
		actionOperations?: readonly unknown[];
	}>,
): OperationWireV3Validation {
	const retained = validateRetainedV2(input.retainedWireV2);
	if (
		(input.actionOperation === undefined) ===
		(input.actionOperations === undefined)
	)
		fail("exactly one Action operation input form is required");
	const actions = (input.actionOperations ?? [input.actionOperation]).map(
		(candidate) => actionOperation(candidate),
	);
	if (actions.length === 0) fail("at least one Action operation is required");
	const actionIdentities = actions.map((action) => action.identity as string);
	if (new Set(actionIdentities).size !== actionIdentities.length)
		fail("Action operations are duplicated");
	const wire = record(input.wire, "Operation Wire v3");
	exactKeys(wire, v3Keys, "Operation Wire v3");
	if (wire.format !== "questpie.operation-wire" || wire.version !== 3)
		fail("Operation Wire v3 discriminator is invalid");
	const unsigned = { ...wire };
	delete unsigned.digest;
	if (wire.digest !== digest("questpie-operation-wire-v3", unsigned))
		fail("Operation Wire v3 digest does not match");
	exact(wire, expectedWire(retained, actions), "Operation Wire v3 projection");
	const compatibility = record(
		retained.compatibility,
		"retained compatibility",
	);
	return Object.freeze({
		digest: wire.digest as string,
		pairs: Object.freeze({
			currentV3: Object.freeze({
				clientContractDigest: retained.clientContractDigest as string,
				wireDigest: wire.digest as string,
			}),
			retainedV2: Object.freeze({
				clientContractDigest: retained.clientContractDigest as string,
				wireDigest: retained.digest as string,
			}),
			retainedV1: Object.freeze({
				clientContractDigest: compatibility.clientContractDigest as string,
				wireDigest: compatibility.wireV1Digest as string,
			}),
		}),
	});
}

function samePair(left: Pair, right: Pair): boolean {
	return (
		left.clientContractDigest === right.clientContractDigest &&
		left.wireDigest === right.wireDigest
	);
}

function operationKind(value: unknown): "action" | "mutation" | "query" {
	if (typeof value !== "string") fail("request operation is invalid");
	if (value.startsWith("action:")) {
		validResourceIdentity(value, "action");
		return "action";
	}
	for (const kind of ["mutation", "query"] as const) {
		if (!value.startsWith(`${kind}:`)) continue;
		const name = value.slice(kind.length + 1);
		if (
			name.length > 255 ||
			!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name) ||
			name.split(".").some((segment) => segment.length > 63)
		)
			fail("request operation is invalid");
		return kind;
	}
	fail("request operation is invalid");
}

function validResourceIdentity(
	value: unknown,
	kind: "action" | "mutation" | "query",
): string {
	if (typeof value !== "string" || !value.startsWith(`${kind}:`))
		fail(`${kind} Resource Identity is invalid`);
	const name = value.slice(kind.length + 1);
	const segments = name.split(".");
	if (
		name.length > 255 ||
		!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name) ||
		segments.some((segment) => segment.length > 63) ||
		(kind === "action" && segments.at(-1) === "then")
	)
		fail(`${kind} Resource Identity is invalid`);
	return value;
}

function validEffectKey(value: unknown): boolean {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		return false;
	let scalars = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
		scalars += 1;
	}
	return (
		scalars <= 256 &&
		Buffer.byteLength(value, "utf8") <= 1_024 &&
		value.normalize("NFC") === value
	);
}

export function negotiateOperationWireV3(
	input: Readonly<{
		wire: unknown;
		retainedWireV2: unknown;
		actionOperation: unknown;
		selectedOperation: string;
		request: unknown;
		enterContext(): void;
		createService(): void;
		enterHandler(): void;
	}>,
): "accepted" | "CLIENT_OUTDATED" {
	const validated = validateOperationWireV3(input);
	const request = record(input.request, "Operation request");
	if (
		typeof request.clientContractDigest !== "string" ||
		typeof request.wireDigest !== "string"
	)
		fail("request compatibility pair is invalid");
	const requestPair = {
		clientContractDigest: request.clientContractDigest,
		wireDigest: request.wireDigest,
	};
	const version = samePair(requestPair, validated.pairs.currentV3)
		? 3
		: samePair(requestPair, validated.pairs.retainedV2)
			? 2
			: samePair(requestPair, validated.pairs.retainedV1)
				? 1
				: null;
	if (version === null) return "CLIENT_OUTDATED";
	const requestedOperation = request.operation;
	const requestedKind = operationKind(requestedOperation);
	const selectedKind = operationKind(input.selectedOperation);
	if (requestedOperation !== input.selectedOperation) {
		if (
			version < 3 &&
			(requestedKind === "action" || selectedKind === "action")
		)
			return "CLIENT_OUTDATED";
		fail("request operation does not match the selected operation");
	}
	if (requestedKind === "action" && version < 3) return "CLIENT_OUTDATED";
	if (requestedKind === "mutation" && version === 1) return "CLIENT_OUTDATED";
	const expectedKeys =
		requestedKind === "action" ? actionRequestKeys : ordinaryRequestKeys;
	exactKeys(request, expectedKeys, "Operation request");
	if (!isOperationCallId(request.callId)) fail("request callId is invalid");
	if (requestedKind === "action" && !validEffectKey(request.effectKey))
		fail("request effectKey is invalid");
	input.enterContext();
	input.createService();
	input.enterHandler();
	return "accepted";
}
