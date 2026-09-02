/** Renders the canonical Query GET carrier used by the generated client. */
export function renderClientQueryHttp(
	input: Readonly<{
		application: string;
		clientContractDigest: string;
		httpContractDigest: string;
	}>,
): string {
	return String.raw`
const canonicalFailures: WireRecord = Object.freeze({
	DEADLINE_EXCEEDED: Object.freeze({ status: 408, retryable: true }),
	INTERNAL: Object.freeze({ status: 500, retryable: false }),
	NOT_FOUND: Object.freeze({ status: 404, retryable: false }),
	PROTOCOL_UNSUPPORTED: Object.freeze({ status: 400, retryable: false }),
	RESOURCE_LIMIT: Object.freeze({ status: 429, retryable: true }),
	RUNTIME_UNAVAILABLE: Object.freeze({ status: 503, retryable: true }),
	UNAUTHENTICATED: Object.freeze({ status: 401, retryable: false }),
});
function utf8Length(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
function base64Url(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function unwrapHttpCodec(value: unknown): WireRecord {
	let codec = wireRecord(value);
	while (codec.kind === "optional" || codec.kind === "nullable") codec = wireRecord(codec.codec);
	return codec;
}
function boundedHttpCodec(value: unknown): boolean {
	const codec = wireRecord(value);
	if (codec.kind === "optional" || codec.kind === "nullable") return boundedHttpCodec(codec.codec);
	if (codec.kind === "text") return Number.isSafeInteger(codec.maxLength) && Number(codec.maxLength) >= 0;
	if (codec.kind === "array") return Number.isSafeInteger(codec.maximum) && Number(codec.maximum) >= 1 && boundedHttpCodec(codec.items);
	if (codec.kind === "object") return Object.values(wireRecord(codec.properties)).every(boundedHttpCodec);
	return codec.kind !== "json";
}
function queryLexical(codecValue: unknown, value: unknown): string {
	if (value === null) return "~null";
	const kind = unwrapHttpCodec(codecValue).kind;
	if (kind === "text") {
		if (typeof value !== "string") return protocolFailure();
		return value.startsWith("~") ? "~text:" + value : value;
	}
	if (kind === "boolean" || kind === "integer") return String(value);
	if (["bigint", "numeric", "uuid", "date", "timestamp", "cursor"].includes(String(kind))) {
		if (typeof value !== "string") return protocolFailure();
		return value;
	}
	return "~json:" + JSON.stringify(value);
}
function canonicalQueryString(codecValue: unknown, value: unknown): string {
	const codec = wireRecord(codecValue);
	if (codec.kind !== "object" || !boundedHttpCodec(codec)) return protocolFailure();
	const encoded = wireRecord(encode(codec, value));
	const properties = wireRecord(codec.properties);
	const query = Object.keys(encoded).sort().map((name) => {
		if (!Object.hasOwn(properties, name)) return protocolFailure();
		return encodeURIComponent(name) + "=" + encodeURIComponent(queryLexical(properties[name], encoded[name]));
	}).join("&");
	if (utf8Length(query) > 16_384) return protocolFailure();
	return query;
}
function canonicalContext(codecValue: unknown, value: unknown): string {
	const json = JSON.stringify(encode(codecValue, value));
	if (utf8Length(json) > 65_536) return protocolFailure();
	return base64Url(json);
}
function identityHeader(value: string): string {
	if (!isCallIdentity(value)) return protocolFailure();
	return encodeURIComponent(value);
}
async function invokeCanonicalQuery<Result>(input: Readonly<{
	transport: FetchTransport;
	baseUrl: string;
	context: AppContextInput;
	operation: string;
	operationInput: unknown;
	options: CallOptions;
	callId: string;
}>): Promise<Result> {
	const optionKeys = Object.keys(input.options).sort();
	if (optionKeys.some((key) => !["callId", "signal", "timeoutMilliseconds"].includes(key))) return protocolFailure();
	if (input.options.timeoutMilliseconds !== undefined && (!Number.isSafeInteger(input.options.timeoutMilliseconds) || input.options.timeoutMilliseconds <= 0)) return protocolFailure();
	const name = input.operation.slice("query:".length);
	if (!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name)) return protocolFailure();
	const query = canonicalQueryString(inputCodecs[input.operation], input.operationInput);
	const headers = new Headers({
		"Questpie-Application": ${JSON.stringify(input.application)},
		"Questpie-Client-Contract": ${JSON.stringify(input.clientContractDigest)},
		"Questpie-Context": canonicalContext(contextCodec, input.context),
		"Questpie-Wire-Digest": ${JSON.stringify(input.httpContractDigest)},
		"Questpie-Call-Id": identityHeader(input.callId),
	});
	if (input.options.timeoutMilliseconds !== undefined) headers.set("Questpie-Timeout-Milliseconds", String(input.options.timeoutMilliseconds));
	let request: Request;
	try {
		const url = new URL("/_questpie/query/" + name, input.baseUrl);
		url.search = query;
		request = new Request(url, { method: "GET", headers, ...(input.options.signal === undefined ? {} : { signal: input.options.signal }) });
	} catch { return protocolFailure(); }
	const response = await input.transport(request);
	if (response.headers.get("content-type") !== "application/json; charset=utf-8") return protocolFailure();
	const frame = wireRecord(await response.json());
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
	if (Object.hasOwn(detail, "payload")) {
		if (!correlated) return protocolFailure();
		exactKeys(detail, ["code", "payload"]);
		if (typeof detail.code !== "string") return protocolFailure();
		const allowed = declaredErrorContracts[input.operation];
		if (!Array.isArray(allowed)) return protocolFailure();
		const contract = allowed.map(wireRecord).find((candidate) => candidate.code === detail.code);
		if (!contract || response.status !== contract.status) return protocolFailure();
		const payload = contract.payload === null ? detail.payload === null ? null : protocolFailure() : decode(contract.payload, detail.payload);
		throw publicError({ code: detail.code, status: contract.status, payload });
	}
	exactKeys(detail, ["code", "retryable"]);
	if (typeof detail.code !== "string" || typeof detail.retryable !== "boolean") return protocolFailure();
	const failureContract = wireRecord(canonicalFailures[detail.code]);
	if (response.status !== failureContract.status || detail.retryable !== failureContract.retryable) return protocolFailure();
	throw publicError(detail);
}
`;
}
