/**
 * Query-string encoding for the client SDK.
 *
 * Replaces `qs` on the client path. `qs` is 13 KB but drags `object-inspect`
 * (19 KB) and `get-intrinsic` (15 KB) with it — ~47 KB of a 432 KB client
 * bundle, for query strings, in a bundle whose actual typed client is 27 KB.
 *
 * This implements exactly the one configuration the client uses at all 25 call
 * sites — `{ skipNulls: true, arrayFormat: "brackets" }` — and nothing else.
 * It is not a `qs` replacement; it is the subset the wire format needs.
 *
 * The server still parses with `qs.parse(..., { allowDots: true, comma: true })`
 * (`server/adapters/utils/request.ts`). Server bundle size is not a concern and
 * parsing untrusted input correctly is a much harder problem than emitting it,
 * so that side deliberately keeps the library.
 *
 * Output is byte-identical to `qs.stringify` for the shapes the client sends;
 * `test/units/query-string.test.ts` asserts that differentially against `qs`
 * itself rather than against hand-written expectations.
 */

/**
 * RFC3986 percent-encoding, matching `qs`'s default encoder.
 *
 * `encodeURIComponent` leaves `!'()*` unescaped; RFC3986 reserves them. The
 * difference is not merely cosmetic here — matching it is what lets the
 * differential test assert byte equality rather than "close enough".
 */
function encode(value: string): string {
	return encodeURIComponent(value).replace(
		/[!'()*]/g,
		(char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/** Scalars `qs` renders directly. Everything else is walked. */
function isScalar(value: unknown): value is string | number | boolean {
	const type = typeof value;
	return type === "string" || type === "number" || type === "boolean";
}

function serializeValue(value: string | number | boolean | Date): string {
	// `qs` serialises Date via toISOString, and the server's date parsing
	// depends on that exact shape.
	return value instanceof Date ? value.toISOString() : String(value);
}

function walk(key: string, value: unknown, out: string[]): void {
	// skipNulls: null and undefined are omitted entirely — not rendered as
	// empty. An empty string, 0 and false are all kept.
	if (value === null || value === undefined) return;

	if (Array.isArray(value)) {
		// arrayFormat "brackets": every element repeats `key[]`, with no index.
		// An array of objects becomes `key[][prop]=…` for each element.
		for (const item of value) walk(`${key}[]`, item, out);
		return;
	}

	if (value instanceof Date || isScalar(value)) {
		out.push(`${encode(key)}=${encode(serializeValue(value))}`);
		return;
	}

	if (typeof value === "object") {
		for (const [childKey, childValue] of Object.entries(value)) {
			walk(`${key}[${childKey}]`, childValue, out);
		}
		return;
	}

	// Functions and symbols: `qs` drops them. Reaching here means a caller
	// passed something that cannot cross the wire, and silently omitting it
	// matches the previous behaviour.
}

/**
 * Serialize an object to a query string, without the leading `?`.
 *
 * Equivalent to `qs.stringify(input, { skipNulls: true, arrayFormat: "brackets" })`.
 * Returns `""` for an empty result, so callers can test it before prefixing.
 */
export function stringifyQuery(input: Record<string, unknown>): string {
	const out: string[] = [];
	for (const [key, value] of Object.entries(input)) walk(key, value, out);
	return out.join("&");
}
