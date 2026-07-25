/**
 * One place for the sandbox broker's decoded payload and derived wire budgets.
 *
 * `http.fetch` bodies are binary-to-base64, then nested in JSON RPC envelopes.
 * The transport limits therefore cannot equal the decoded body limit. Keep all
 * supervisor, route, frame, and custom-tool caps derived here.
 */

/** Decoded request/response body limit promised by `http.fetch`. */
export const BROKER_HTTP_BODY_CAP_BYTES = 5 * 1024 * 1024;

/** Exact maximum base64 length for a decoded HTTP body at the public cap. */
export const BROKER_HTTP_BASE64_CAP_BYTES =
	4 * Math.ceil(BROKER_HTTP_BODY_CAP_BYTES / 3);

/**
 * Room for URL, method, bounded HTTP headers, status metadata, and JSON RPC
 * envelope syntax around a maximum-size base64 body.
 */
export const BROKER_HTTP_JSON_HEADROOM_BYTES = 128 * 1024;

/** Whole JSON request/response budget for the `http.fetch` method. */
export const BROKER_HTTP_WIRE_CAP_BYTES =
	BROKER_HTTP_BASE64_CAP_BYTES + BROKER_HTTP_JSON_HEADROOM_BYTES;

/** Existing small native binding request budget, including its JSON envelope. */
export const BROKER_NATIVE_REQUEST_WIRE_CAP_BYTES = 64 * 1024;

/** Maximum JSON value returned by native bindings before envelope overhead. */
export const BROKER_NATIVE_RESULT_CAP_BYTES = 768 * 1024;

/** Custom-tool logical limits; shared with the host session implementation. */
export const BROKER_CUSTOM_ARGUMENT_CAP_BYTES = 63 * 1024;
export const BROKER_CUSTOM_RESULT_CAP_BYTES = 768 * 1024;
export const BROKER_CUSTOM_LIST_CAP_BYTES = 768 * 1024;

const BROKER_JSON_ENVELOPE_HEADROOM_BYTES = 4 * 1024;

export const BROKER_NATIVE_RESPONSE_WIRE_CAP_BYTES =
	BROKER_NATIVE_RESULT_CAP_BYTES + BROKER_JSON_ENVELOPE_HEADROOM_BYTES;
export const BROKER_CUSTOM_REQUEST_WIRE_CAP_BYTES =
	BROKER_CUSTOM_ARGUMENT_CAP_BYTES + BROKER_JSON_ENVELOPE_HEADROOM_BYTES;
export const BROKER_CUSTOM_RESPONSE_WIRE_CAP_BYTES =
	Math.max(BROKER_CUSTOM_RESULT_CAP_BYTES, BROKER_CUSTOM_LIST_CAP_BYTES) +
	BROKER_JSON_ENVELOPE_HEADROOM_BYTES;

/** Maximum body the app broker route will read before method-aware validation. */
export const BROKER_MAX_REQUEST_WIRE_BYTES = Math.max(
	BROKER_HTTP_WIRE_CAP_BYTES,
	BROKER_NATIVE_REQUEST_WIRE_CAP_BYTES,
	BROKER_CUSTOM_REQUEST_WIRE_CAP_BYTES,
);

/** Maximum response the supervisor will read before method-aware validation. */
export const BROKER_MAX_RESPONSE_WIRE_BYTES = Math.max(
	BROKER_HTTP_WIRE_CAP_BYTES,
	BROKER_NATIVE_RESPONSE_WIRE_CAP_BYTES,
	BROKER_CUSTOM_RESPONSE_WIRE_CAP_BYTES,
);

/** Prefix/newline room around the largest JSON RPC frame. */
export const BROKER_FRAME_CAP_BYTES =
	Math.max(BROKER_MAX_REQUEST_WIRE_BYTES, BROKER_MAX_RESPONSE_WIRE_BYTES) +
	1024;

/**
 * A run may emit one maximum RPC request and still return a maximum-sized final
 * frame. Repeated large calls remain bounded by this cumulative budget.
 */
export const BROKER_TOTAL_OUTPUT_CAP_BYTES = BROKER_FRAME_CAP_BYTES * 2;

export function brokerRequestWireCap(method: string): number {
	if (method === "http.fetch") return BROKER_HTTP_WIRE_CAP_BYTES;
	if (method === "tools.call") return BROKER_CUSTOM_REQUEST_WIRE_CAP_BYTES;
	if (method === "tools.list") return BROKER_JSON_ENVELOPE_HEADROOM_BYTES;
	return BROKER_NATIVE_REQUEST_WIRE_CAP_BYTES;
}

export function brokerResponseWireCap(method: string): number {
	if (method === "http.fetch") return BROKER_HTTP_WIRE_CAP_BYTES;
	if (method === "tools.call" || method === "tools.list") {
		return BROKER_CUSTOM_RESPONSE_WIRE_CAP_BYTES;
	}
	return BROKER_NATIVE_RESPONSE_WIRE_CAP_BYTES;
}

export function brokerResultValueCap(method: string): number {
	if (method === "http.fetch") {
		return BROKER_HTTP_WIRE_CAP_BYTES - BROKER_JSON_ENVELOPE_HEADROOM_BYTES;
	}
	if (method === "tools.call") return BROKER_CUSTOM_RESULT_CAP_BYTES;
	if (method === "tools.list") return BROKER_CUSTOM_LIST_CAP_BYTES;
	return BROKER_NATIVE_RESULT_CAP_BYTES;
}
