/**
 * JSON-safe coercion for audit-log `changes` / `metadata`.
 *
 * The audit-log collection stores `changes` and `metadata` as `f.json()` fields,
 * validated by the core `jsonValueSchema` (string | number | boolean | null |
 * array | record). But the audit diff captures RAW collection field values — a
 * `datetime` field yields a `Date`, a `bigint` column yields a `bigint`, etc. —
 * none of which the JSON-primitive schema accepts. That threw an `ApiError` on
 * every write that touched such a field (for example, a frequently updated
 * heartbeat timestamp, which could spam the log on every tick).
 *
 * This recursively coerces a value into a JSON-safe shape BEFORE it reaches the
 * audit schema: Date -> ISO string, undefined -> null, bigint -> string,
 * non-finite numbers -> null, arrays/plain-objects recurse, primitives pass, and
 * anything else not representable (function/symbol) -> null. The result always
 * survives `JSON.stringify`/`parse` unchanged.
 */
export function toAuditJsonSafe(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) {
		const time = value.getTime();
		return Number.isNaN(time) ? null : value.toISOString();
	}

	const type = typeof value;
	if (type === "string" || type === "boolean") return value;
	if (type === "number") return Number.isFinite(value as number) ? value : null;
	if (type === "bigint") return (value as bigint).toString();

	if (Array.isArray(value)) {
		return value.map((item) => toAuditJsonSafe(item));
	}

	if (type === "object") {
		// A toJSON-bearing value (other than Date, handled above) knows its own
		// serialization — honour it, then coerce the result.
		const maybeToJson = (value as { toJSON?: () => unknown }).toJSON;
		if (typeof maybeToJson === "function") {
			return toAuditJsonSafe(maybeToJson.call(value));
		}
		const out: Record<string, unknown> = {};
		for (const [key, item] of Object.entries(
			value as Record<string, unknown>,
		)) {
			out[key] = toAuditJsonSafe(item);
		}
		return out;
	}

	// function / symbol — not representable in JSON.
	return null;
}
