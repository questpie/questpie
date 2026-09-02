import {
	canonicalOperationFailure,
	isOperationCallId,
	OperationFailure,
} from "../operation";

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

export function createHttpExecutionControl(
	input: Readonly<{
		requestSignal: AbortSignal;
		requestStartedAt: number;
		timeoutMilliseconds?: number;
		now(): number;
	}>,
): Readonly<{
	deadline?: number;
	signal: AbortSignal;
	close(): void;
}> {
	const controller = new AbortController();
	const deadline =
		input.timeoutMilliseconds === undefined
			? undefined
			: Math.min(
					Number.MAX_SAFE_INTEGER,
					input.requestStartedAt + input.timeoutMilliseconds,
				);
	const abortFromRequest = () => {
		if (!controller.signal.aborted)
			controller.abort(input.requestSignal.reason);
	};
	input.requestSignal.addEventListener("abort", abortFromRequest, {
		once: true,
	});
	if (input.requestSignal.aborted) abortFromRequest();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const schedule = () => {
		if (deadline === undefined || controller.signal.aborted) return;
		const remaining = deadline - input.now();
		if (remaining <= 0) {
			controller.abort(new OperationFailure("DEADLINE_EXCEEDED"));
			return;
		}
		timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
	};
	schedule();
	return Object.freeze({
		...(deadline === undefined ? {} : { deadline }),
		signal: controller.signal,
		close: () => {
			input.requestSignal.removeEventListener("abort", abortFromRequest);
			if (timer !== undefined) clearTimeout(timer);
		},
	});
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
	const contract = canonicalOperationFailure(code);
	return httpJsonResponse(
		{
			...(options.callId === undefined ? {} : { callId: options.callId }),
			error: {
				code: contract.code,
				retryable: options.retryable ?? contract.retryable,
			},
		},
		contract.status,
		options.cacheControl,
	);
}
