/**
 * Field Builder V2 — Zod Schema Auto-Derivation
 *
 * Standard fields derive Zod schemas from their type + accumulated refinements.
 * Only f.from() with an explicit Zod schema bypasses auto-derivation.
 */

import { z, type ZodType } from "zod";

import type { FieldRuntimeState } from "./field-class-types.js";

// ============================================================================
// Base Schema Per Type
// ============================================================================

/**
 * Get the base Zod schema for a field type.
 * Returns the simplest possible schema for the type.
 */
function baseSchemaForType(type: string): ZodType {
	switch (type) {
		case "text":
		case "textarea":
		case "email":
		case "url":
		case "select":
			return z.string();
		case "number":
			return z.number();
		case "boolean":
			return z.boolean();
		case "date":
		case "datetime":
		case "time":
			return z.union([z.string(), z.date()]);
		case "json":
		case "object":
			return z.unknown();
		case "relation":
		case "upload":
			return z.string().uuid();
		default:
			return z.unknown();
	}
}

// ============================================================================
// Build Zod From State
// ============================================================================

/**
 * Build a complete Zod schema from field runtime state.
 *
 * Order of operations:
 * 1. Get base schema for type (or use explicit schema factory)
 * 2. Apply field-specific refinements (maxLength, min, pattern, etc.)
 * 3. Apply user's .zod() transform
 * 4. Wrap in z.array() if .array() was called
 * 5. Apply array refinements (minItems, maxItems)
 * 6. Apply nullability (notNull → required, else nullish)
 * 7. Apply input mode (hasDefault → optional)
 */
export function buildZodFromState(state: FieldRuntimeState): ZodType {
	// Use explicit schema factory if provided (f.from())
	let schema: ZodType = state.schemaFactory
		? state.schemaFactory()
		: baseSchemaForType(state.type);

	// Apply field-specific refinements (only for string/number base schemas)
	schema = applyRefinements(schema, state);

	// Apply user's .zod() transform
	if (state.zodTransform) {
		schema = state.zodTransform(schema);
	}

	// Wrap in array if .array() was called
	if (state.isArray) {
		let arraySchema = z.array(schema);

		// Array refinements
		if (state.minItems !== undefined) {
			arraySchema = arraySchema.min(state.minItems);
		}
		if (state.maxItems !== undefined) {
			arraySchema = arraySchema.max(state.maxItems);
		}

		schema = arraySchema;
	}

	// Apply nullability
	if (!state.notNull) {
		schema = schema.nullish();
	}

	// Apply input mode: hasDefault makes the field optional in input
	if (state.hasDefault) {
		schema = schema.optional();
	}

	// Input: "optional" forces optional regardless of notNull
	if (state.input === "optional") {
		schema = schema.optional();
	}

	return schema;
}

// ============================================================================
// Refinement Application
// ============================================================================

/**
 * Apply field-specific refinements to the base schema.
 * Only applies to types that support the refinement methods.
 */
function applyRefinements(schema: ZodType, state: FieldRuntimeState): ZodType {
	// String refinements
	if (
		state.type === "text" ||
		state.type === "textarea" ||
		state.type === "email" ||
		state.type === "url"
	) {
		let s = schema as z.ZodString;
		if (state.maxLength !== undefined) s = s.max(state.maxLength);
		if (state.minLength !== undefined) s = s.min(state.minLength);
		if (state.pattern !== undefined) s = s.regex(state.pattern);
		if (state.type === "email") s = s.email();
		if (state.type === "url") s = s.url();
		return s;
	}

	// Number refinements
	if (state.type === "number") {
		let s = schema as z.ZodNumber;
		if (state.min !== undefined) s = s.min(state.min);
		if (state.max !== undefined) s = s.max(state.max);
		if (state.positive) s = s.positive();
		if (state.int) s = s.int();
		if (state.step !== undefined) {
			s = s.refine((v) => v % state.step! === 0, {
				message: `Must be a multiple of ${state.step}`,
			}) as any;
		}
		return s;
	}

	return schema;
}
