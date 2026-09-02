import { isOperationCallId, OperationFailure } from "../operation";

export const HTTP_JSON_MEDIA_TYPE = "application/json; charset=utf-8";

export type HttpRecord = Readonly<Record<string, unknown>>;

export function httpProtocolFailure(): never {
	throw new OperationFailure("PROTOCOL_UNSUPPORTED");
}

export function httpRecord(value: unknown): HttpRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		httpProtocolFailure();
	return value as HttpRecord;
}

export function exactHttpKeys(
	value: HttpRecord,
	expected: readonly string[],
): void {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	if (
		actual.length !== sorted.length ||
		actual.some((key, index) => key !== sorted[index])
	)
		httpProtocolFailure();
}

export function readHttpHeader(request: Request, name: string): string | null {
	const value = request.headers.get(name);
	if (value?.includes(",")) httpProtocolFailure();
	return value;
}

export function decodeHttpIdentity(value: string): string {
	if (value.includes("+") || /%(?![0-9A-F]{2})/u.test(value))
		httpProtocolFailure();
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		return httpProtocolFailure();
	}
	if (encodeURIComponent(decoded) !== value || !isOperationCallId(decoded))
		httpProtocolFailure();
	return decoded;
}

export function decodeHttpTimeout(value: string | null): number | undefined {
	if (value === null) return undefined;
	if (!/^[1-9][0-9]*$/u.test(value)) httpProtocolFailure();
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) httpProtocolFailure();
	return parsed;
}

function canonicalFailureCode(code: string): string {
	return [
		"DEADLINE_EXCEEDED",
		"INTERNAL",
		"NOT_FOUND",
		"PROTOCOL_UNSUPPORTED",
		"RESOURCE_LIMIT",
		"RUNTIME_UNAVAILABLE",
		"UNAUTHENTICATED",
	].includes(code)
		? code
		: "INTERNAL";
}

function failureStatus(code: string): number {
	if (code === "UNAUTHENTICATED") return 401;
	if (code === "NOT_FOUND") return 404;
	if (code === "DEADLINE_EXCEEDED") return 408;
	if (code === "RESOURCE_LIMIT") return 429;
	if (code === "RUNTIME_UNAVAILABLE") return 503;
	if (code === "PROTOCOL_UNSUPPORTED") return 400;
	return 500;
}

export function httpJsonResponse(
	body: unknown,
	status: number,
	cacheControl?: string,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			...(cacheControl === undefined ? {} : { "cache-control": cacheControl }),
			"content-type": HTTP_JSON_MEDIA_TYPE,
		},
	});
}

export function httpFailure(
	code: string,
	options: Readonly<{
		cacheControl?: string;
		callId?: string;
		retryable?: boolean;
	}> = {},
): Response {
	const canonicalCode = canonicalFailureCode(code);
	return httpJsonResponse(
		{
			...(options.callId === undefined ? {} : { callId: options.callId }),
			error: {
				code: canonicalCode,
				retryable:
					options.retryable ??
					[
						"DEADLINE_EXCEEDED",
						"RESOURCE_LIMIT",
						"RUNTIME_UNAVAILABLE",
					].includes(canonicalCode),
			},
		},
		failureStatus(canonicalCode),
		options.cacheControl,
	);
}
