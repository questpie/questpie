import { canonicalOperationFailures } from "@questpie/runtime/operation";

/** Renders the shared canonical HTTP response decoder for generated clients. */
export function renderClientHttpResponse(): string {
	const failures = Object.entries(canonicalOperationFailures)
		.map(
			([code, contract]) =>
				`\t${code}: Object.freeze({ status: ${contract.status}, retryable: ${String(contract.retryable)} }),`,
		)
		.join("\n");
	return String.raw`
const canonicalFailures: WireRecord = Object.freeze({
${failures}
});
const decodedMutationFailures = new WeakMap<Error, Readonly<{ operation: string; outcome: DecodedMutationFailure }>>();
function recordDecodedMutationFailure(input: Readonly<{ operation: string; callId: string; kind: string }>, error: Error, transactionId?: string): Error {
	if (input.kind === "mutation") decodedMutationFailures.set(error, Object.freeze({
		operation: input.operation,
		outcome: Object.freeze(transactionId === undefined
			? { kind: "rejected", callId: input.callId }
			: { kind: "committed", callId: input.callId, transactionId }),
	}));
	return error;
}
function decodedMutationFailure(operation: string, error: unknown): DecodedMutationFailure | undefined {
	if (!(error instanceof Error)) return undefined;
	const decoded = decodedMutationFailures.get(error);
	return decoded?.operation === operation ? decoded.outcome : undefined;
}
function decodeCanonicalHttpResponse<Result>(input: Readonly<{
	response: Response;
	frame: WireRecord;
	operation: string;
	callId: string;
	kind: "query" | "mutation" | "action";
}>): Result {
	if (Object.hasOwn(input.frame, "result")) {
		exactKeys(input.frame, ["callId", "result"]);
		if (input.response.status !== 200 || input.frame.callId !== input.callId) return protocolFailure();
		return decode(outputCodecs[input.operation], input.frame.result) as Result;
	}
	const correlated = Object.hasOwn(input.frame, "callId");
	if (correlated) {
		exactKeys(input.frame, ["callId", "error"]);
		if (input.frame.callId !== input.callId) return protocolFailure();
	} else exactKeys(input.frame, ["error"]);
	const detail = wireRecord(input.frame.error);
	if (detail.code === "COMMITTED_RESULT_UNAVAILABLE") {
		if (input.kind !== "mutation" || !correlated) return protocolFailure();
		exactKeys(detail, ["code", "retryable", "transactionId"]);
		if (detail.retryable !== true || input.response.status !== 500 || !isTransactionIdentity(detail.transactionId)) return protocolFailure();
		throw recordDecodedMutationFailure(input, new CommittedResultUnavailable(input.callId, detail.transactionId), detail.transactionId);
	}
	if (detail.code === "ACTION_OUTCOME_AMBIGUOUS") {
		if (input.kind !== "action" || !correlated) return protocolFailure();
		exactKeys(detail, ["code", "retryable"]);
		if (detail.retryable !== false || input.response.status !== 500) return protocolFailure();
		throw new ActionOutcomeAmbiguous(input.callId);
	}
	if (detail.code === "RESOURCE_LIMIT" && input.kind === "action" && correlated) {
		exactKeys(detail, ["code", "retryable"]);
		if (detail.retryable !== false || input.response.status !== 429) return protocolFailure();
		throw publicError(detail);
	}
	if (Object.hasOwn(detail, "payload")) {
		if (!correlated) return protocolFailure();
		exactKeys(detail, ["code", "payload"]);
		if (typeof detail.code !== "string") return protocolFailure();
		const allowedErrors = declaredErrorContracts[input.operation];
		if (!Array.isArray(allowedErrors)) return protocolFailure();
		const contract = allowedErrors.map(wireRecord).find((candidate) => candidate.code === detail.code);
		if (!contract || input.response.status !== contract.status) return protocolFailure();
		const payload = contract.payload === null ? detail.payload === null ? null : protocolFailure() : decode(contract.payload, detail.payload);
		throw recordDecodedMutationFailure(input, publicError({ code: detail.code, status: contract.status, payload }));
	}
	exactKeys(detail, ["code", "retryable"]);
	if (typeof detail.code !== "string" || typeof detail.retryable !== "boolean") return protocolFailure();
	const failureContract = wireRecord(canonicalFailures[detail.code]);
	if (input.response.status !== failureContract.status || detail.retryable !== failureContract.retryable) return protocolFailure();
	throw publicError(detail);
}
`;
}
