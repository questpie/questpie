import {
	exactRuntimeArtifactKeys as exact,
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as artifactDigest,
	runtimeArtifactDigestValue as digestValue,
	runtimeArtifactRecord as record,
} from "./artifact-protocol";

function exactStringArray(
	value: unknown,
	expected: readonly string[],
	label: string,
): void {
	if (
		!Array.isArray(value) ||
		value.length !== expected.length ||
		expected.some((item, index) => value[index] !== item)
	)
		fail(`${label} is invalid`);
}

export function validateOperationWireV2(
	wire: Readonly<Record<string, unknown>>,
): void {
	exactStringArray(
		wire.resultKinds,
		["declaredError", "failure", "result"],
		"wire result kinds",
	);
	exactStringArray(
		wire.failures,
		[
			"APPLICATION_MISMATCH",
			"CLIENT_OUTDATED",
			"COMMITTED_RESULT_UNAVAILABLE",
			"DEADLINE_EXCEEDED",
			"INTERNAL",
			"NOT_FOUND",
			"PROTOCOL_UNSUPPORTED",
			"RESOURCE_LIMIT",
			"RUNTIME_UNAVAILABLE",
		],
		"wire failures",
	);
	const details = record(wire.failureDetails, "wire failure details");
	exact(
		details,
		["ordinary", "committedResultUnavailable"],
		"wire failure details",
	);
	exactStringArray(
		details.ordinary,
		["code", "retryable"],
		"ordinary failure detail",
	);
	exactStringArray(
		details.committedResultUnavailable,
		["code", "retryable", "transactionId"],
		"committed-result failure detail",
	);
	const callIdentity = record(wire.callIdentity, "wire call identity");
	exact(
		callIdentity,
		[
			"kind",
			"minimumUnicodeScalars",
			"maximumUnicodeScalars",
			"maximumUtf8Bytes",
			"normalization",
			"normalizationBehavior",
			"loneSurrogates",
			"nullScalar",
			"uuidRequired",
			"runtimeDefaultWhenAbsent",
			"equality",
		],
		"wire call identity",
	);
	if (
		callIdentity.kind !== "text" ||
		callIdentity.minimumUnicodeScalars !== 1 ||
		callIdentity.maximumUnicodeScalars !== 256 ||
		callIdentity.maximumUtf8Bytes !== 1_024 ||
		callIdentity.normalization !== "NFC" ||
		callIdentity.normalizationBehavior !== "rejectNotRewrite" ||
		callIdentity.loneSurrogates !== "forbidden" ||
		callIdentity.nullScalar !== "forbidden" ||
		callIdentity.uuidRequired !== false ||
		callIdentity.runtimeDefaultWhenAbsent !== "crypto.randomUUID" ||
		callIdentity.equality !== "exactUtf8AfterValidation"
	)
		fail("wire call identity is invalid");
	const transactionIdentity = record(
		wire.transactionIdentity,
		"wire transaction identity",
	);
	exact(
		transactionIdentity,
		["kind", "canonicalPattern", "maximum", "clientInterpretation"],
		"wire transaction identity",
	);
	if (
		transactionIdentity.kind !== "postgresXid8Text" ||
		transactionIdentity.canonicalPattern !== "^[1-9][0-9]{0,19}$" ||
		transactionIdentity.maximum !== "18446744073709551615" ||
		transactionIdentity.clientInterpretation !== "opaque"
	)
		fail("wire transaction identity is invalid");
	const committed = record(
		wire.committedResultUnavailable,
		"wire committed result outcome",
	);
	exact(
		committed,
		[
			"classification",
			"httpStatus",
			"retryable",
			"transactionOutcome",
			"automaticRetry",
			"recovery",
			"frameCallIdSource",
			"transactionIdSource",
			"causeDisclosure",
		],
		"wire committed result outcome",
	);
	if (
		committed.classification !== "frameworkTransactionOutcome" ||
		committed.httpStatus !== 500 ||
		committed.retryable !== true ||
		committed.transactionOutcome !== "committed" ||
		committed.automaticRetry !== false ||
		committed.recovery !== "replayExactMutationWithSameCallIdentity" ||
		committed.frameCallIdSource !== "acceptedRequest" ||
		committed.transactionIdSource !== "committedReceipt" ||
		committed.causeDisclosure !== "forbidden"
	)
		fail("wire committed result outcome is invalid");
	const compatibility = record(wire.compatibility, "wire compatibility");
	exact(
		compatibility,
		[
			"clientContractDigest",
			"wireV1Digest",
			"wireV1Source",
			"wireV1MutationExecution",
			"wireV1QueryExecution",
			"wireV1RejectionCode",
		],
		"wire compatibility",
	);
	digestValue(
		compatibility.clientContractDigest,
		"wire v1 compatibility client contract digest",
	);
	digestValue(compatibility.wireV1Digest, "wire v1 compatibility digest");
	if (
		compatibility.wireV1Source !==
			"sameApplicationClientContractAndOperations" ||
		compatibility.wireV1MutationExecution !==
			"rejectBeforeContextAndOperation" ||
		compatibility.wireV1QueryExecution !== "allowed" ||
		compatibility.wireV1RejectionCode !== "CLIENT_OUTDATED"
	)
		fail("wire compatibility is invalid");
	const {
		failureDetails: _failureDetails,
		resultKinds: _resultKinds,
		callIdentity: _callIdentity,
		transactionIdentity: _transactionIdentity,
		committedResultUnavailable: _committedResultUnavailable,
		compatibility: _compatibility,
		digest: _wireV2Digest,
		...sharedWire
	} = wire;
	const siblingV1 = {
		...sharedWire,
		version: 1,
		clientContractDigest: compatibility.clientContractDigest,
		failures: (wire.failures as readonly unknown[]).filter(
			(code) => code !== "COMMITTED_RESULT_UNAVAILABLE",
		),
	};
	if (
		artifactDigest("questpie-operation-wire-v1", siblingV1) !==
		compatibility.wireV1Digest
	)
		fail("wire v1 compatibility digest does not match sibling contract");
}
