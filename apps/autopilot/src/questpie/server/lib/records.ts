import type { JsonValue } from "questpie";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.id === "string") return value.id;
	return null;
}

export function asRecord(value: unknown): Record<string, JsonValue> {
	// Coerce arbitrary unknown (typically a value read from a JSON column, which
	// is JsonValue at runtime) into a typed JSON object at this boundary.
	return isRecord(value) ? (value as Record<string, JsonValue>) : {};
}

export function mergeRecords(
	...values: Array<unknown>
): Record<string, JsonValue> {
	return Object.assign({}, ...values.map(asRecord));
}

export function stringFrom(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
