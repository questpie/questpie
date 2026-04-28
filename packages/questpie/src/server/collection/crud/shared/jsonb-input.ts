/**
 * JSONB input normalization.
 *
 * Drizzle's pg `jsonb` column already serializes JS values to JSON via
 * `mapToDriverValue`. If the framework (or upstream caller — e.g. a seed
 * script, an RPC layer, a custom hook) hands Drizzle a value that is *already*
 * a JSON-encoded string, Drizzle stringifies it a second time and the column
 * stores the encoded string as a jsonb string instead of the intended array
 * or object. Reads then return strings to clients, breaking any consumer
 * that iterates the value as an array.
 *
 * This helper normalizes the input *before* it reaches Drizzle's `set(...)` /
 * `values(...)`. For every field that is backed by a jsonb column, if the
 * value is a string that parses as a JSON array or object, it is replaced
 * with the parsed value. Non-jsonb fields are left untouched so that
 * legitimate text-column strings are preserved.
 */

import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";

/**
 * Drizzle column types that store as PostgreSQL jsonb.
 *
 * `array` is the result of any `.array()` call — `Field.array()` overrides the
 * column factory to `jsonb(name)` regardless of the inner field's type.
 * `json` defaults to `mode: "jsonb"` (the `mode: "json"` variant is mapped
 * the same way by Drizzle, so the same normalization applies).
 */
const JSONB_FIELD_TYPES = new Set([
	"array",
	"object",
	"json",
	"blocks",
]);

/**
 * True if `fieldDef` is stored as a jsonb column.
 */
export function isJsonbBackedField(fieldDef: Field<FieldState>): boolean {
	if (fieldDef._state.isArray) return true;
	return JSONB_FIELD_TYPES.has(fieldDef.getType());
}

/**
 * Decode a value that was accidentally pre-stringified for a jsonb column.
 * Only string inputs that parse as a JSON array or object are decoded —
 * primitive jsonb values (number / boolean / quoted string) and unparseable
 * strings are returned untouched, since `jsonb` legitimately accepts those.
 */
function decodePreStringifiedJsonb(value: unknown): unknown {
	if (typeof value !== "string") return value;

	// Cheap shape check first — avoids paying for JSON.parse on every plain
	// string we might encounter (description fields, etc.).
	const trimmed = value.trim();
	const first = trimmed.charCodeAt(0);
	const ARRAY_OPEN = 0x5b; // [
	const OBJECT_OPEN = 0x7b; // {
	if (first !== ARRAY_OPEN && first !== OBJECT_OPEN) return value;

	try {
		const parsed = JSON.parse(value);
		if (
			parsed !== null &&
			(Array.isArray(parsed) || typeof parsed === "object")
		) {
			return parsed;
		}
	} catch {
		// Not valid JSON — leave the string as-is. Drizzle will stringify it
		// once and Postgres will store it as a jsonb string, which is
		// presumably what the caller intended.
	}
	return value;
}

/**
 * Normalize input data for jsonb-backed fields by decoding any
 * accidentally-stringified array/object values back into plain JS.
 *
 * Runs before field input hooks so that hooks (`beforeChange`, etc.) always
 * see decoded values, never JSON strings.
 *
 * @param data - Input data being prepared for write
 * @param fieldDefinitions - Field definitions for the collection / global
 * @returns A new object with jsonb fields normalized; other fields untouched
 */
export function normalizeJsonbInput(
	data: Record<string, unknown>,
	fieldDefinitions: Record<string, Field<FieldState>> | undefined,
): Record<string, unknown> {
	if (!fieldDefinitions) return data;

	let result: Record<string, unknown> | null = null;

	for (const [key, value] of Object.entries(data)) {
		const fieldDef = fieldDefinitions[key];
		if (!fieldDef || !isJsonbBackedField(fieldDef)) continue;

		const normalized = decodePreStringifiedJsonb(value);
		if (normalized !== value) {
			if (result === null) result = { ...data };
			result[key] = normalized;
		}
	}

	return result ?? data;
}
