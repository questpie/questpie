/** Renders canonical Mutation and Action POST transport for the generated client. */
export function renderClientPostHttp(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
	}>,
): string {
	return String.raw`
async function invokeCanonicalPost<Result>(input: Readonly<{
	transport: FetchTransport;
	baseUrl: string;
	context: AppContextInput;
	operation: string;
	operationInput: unknown;
	options: CallOptions | ActionCallOptions;
	callId: string;
	action: boolean;
}>): Promise<Result> {
	const optionKeys = Object.keys(input.options).sort();
	const allowed = input.action
		? ["callId", "effectKey", "signal", "timeoutMilliseconds"]
		: ["callId", "signal", "timeoutMilliseconds"];
	if (optionKeys.some((key) => !allowed.includes(key))) return protocolFailure();
	if (input.action && (!optionKeys.includes("effectKey") || !isCallIdentity((input.options as ActionCallOptions).effectKey))) return protocolFailure();
	if (input.options.timeoutMilliseconds !== undefined && (!Number.isSafeInteger(input.options.timeoutMilliseconds) || input.options.timeoutMilliseconds <= 0)) return protocolFailure();
	if (input.options.signal?.aborted) throw input.options.signal.reason;
	const name = input.operation.slice(input.action ? "action:".length : "mutation:".length);
	if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name)) return protocolFailure();
	const headers = new Headers({
		"content-type": "application/json",
		"Questpie-Application": ${JSON.stringify(input.application)},
		"Questpie-Client-Contract": ${JSON.stringify(input.clientContractDigest)},
		"Questpie-Wire-Digest": ${JSON.stringify(input.httpContractDigest)},
	});
	if (input.action) {
		headers.set("Effect-Key", identityHeader((input.options as ActionCallOptions).effectKey));
		headers.set("Questpie-Call-Id", identityHeader(input.callId));
	} else headers.set("Idempotency-Key", identityHeader(input.callId));
	if (input.options.timeoutMilliseconds !== undefined) headers.set("Questpie-Timeout-Milliseconds", String(input.options.timeoutMilliseconds));
	let request: Request;
	try {
		request = new Request(new URL("/_questpie/" + (input.action ? "action/" : "mutation/") + name, input.baseUrl), {
			method: "POST",
			headers,
			body: JSON.stringify({
				context: encode(contextCodec, input.context),
				input: encode(inputCodecs[input.operation], input.operationInput),
			}),
			...(input.options.signal === undefined ? {} : { signal: input.options.signal }),
		});
	} catch { return protocolFailure(); }
	let response: Response;
	let frame: WireRecord;
	try {
		response = await input.transport(request);
		if (response.headers.get("content-type") !== "application/json; charset=utf-8") return protocolFailure();
		frame = wireRecord(await response.json());
	} catch (error) {
		if (input.action) throw new ActionOutcomeAmbiguous(input.callId);
		throw error;
	}
	try {
		if (Object.hasOwn(frame, "result")) {
			exactKeys(frame, ["callId", "result"]);
			if (response.status !== 200 || frame.callId !== input.callId) return protocolFailure();
			return decode(outputCodecs[input.operation], frame.result) as Result;
		}
		const correlated = Object.hasOwn(frame, "callId");
		if (correlated) {
			exactKeys(frame, ["callId", "error"]);
			if (frame.callId !== input.callId) return protocolFailure();
		} else exactKeys(frame, ["error"]);
		const detail = wireRecord(frame.error);
		if (detail.code === "COMMITTED_RESULT_UNAVAILABLE") {
			if (input.action || !correlated) return protocolFailure();
			exactKeys(detail, ["code", "retryable", "transactionId"]);
			if (detail.retryable !== true || response.status !== 500 || !isTransactionIdentity(detail.transactionId)) return protocolFailure();
			throw new CommittedResultUnavailable(input.callId, detail.transactionId);
		}
		if (detail.code === "ACTION_OUTCOME_AMBIGUOUS") {
			if (!input.action || !correlated) return protocolFailure();
			exactKeys(detail, ["code", "retryable"]);
			if (detail.retryable !== false || response.status !== 500) return protocolFailure();
			throw new ActionOutcomeAmbiguous(input.callId);
		}
		if (detail.code === "RESOURCE_LIMIT" && input.action && correlated) {
			exactKeys(detail, ["code", "retryable"]);
			if (detail.retryable !== false || response.status !== 429) return protocolFailure();
			throw publicError(detail);
		}
		if (Object.hasOwn(detail, "payload")) {
			if (!correlated) return protocolFailure();
			exactKeys(detail, ["code", "payload"]);
			if (typeof detail.code !== "string") return protocolFailure();
			const allowedErrors = declaredErrorContracts[input.operation];
			if (!Array.isArray(allowedErrors)) return protocolFailure();
			const contract = allowedErrors.map(wireRecord).find((candidate) => candidate.code === detail.code);
			if (!contract || response.status !== contract.status) return protocolFailure();
			const payload = contract.payload === null ? detail.payload === null ? null : protocolFailure() : decode(contract.payload, detail.payload);
			throw publicError({ code: detail.code, status: contract.status, payload });
		}
		exactKeys(detail, ["code", "retryable"]);
		if (typeof detail.code !== "string" || typeof detail.retryable !== "boolean") return protocolFailure();
		const failureContract = wireRecord(canonicalFailures[detail.code]);
		if (response.status !== failureContract.status || detail.retryable !== failureContract.retryable) return protocolFailure();
		throw publicError(detail);
	} catch (error) {
		if (input.action && error instanceof ProtocolFailure) throw new ActionOutcomeAmbiguous(input.callId);
		throw error;
	}
}
`;
}
