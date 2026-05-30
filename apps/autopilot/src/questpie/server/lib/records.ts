import type { JsonValue } from "questpie/builders";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.id === "string") return value.id;
	return null;
}

export function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function mergeRecords(
	...values: Array<unknown>
): Record<string, unknown> {
	return Object.assign({}, ...values.map(asRecord));
}

export function asJsonValue(value: unknown): JsonValue {
	return value as JsonValue;
}

export function stringFrom(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}
