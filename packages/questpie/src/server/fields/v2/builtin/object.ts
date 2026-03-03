/**
 * Object Field Factory (V2)
 */

import { jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { objectOps } from "../../operators/builtin.js";
import { createField } from "../field.js";
import type { DefaultFieldState } from "../types.js";
import type { FieldDefinition, FieldDefinitionState, NestedFieldMetadata } from "../../types.js";

export type ObjectFieldState = DefaultFieldState & {
	type: "object";
	data: Record<string, unknown>;
};

/**
 * Create a structured object field (stored as JSONB).
 *
 * @param fields - Nested field definitions
 *
 * @example
 * ```ts
 * address: f.object({
 *   street: f.text().required(),
 *   city: f.text().required(),
 *   zip: f.text(10),
 * })
 * ```
 */
export function object(
	fields: Record<string, Field<any>>,
): Field<ObjectFieldState> {
	return createField<ObjectFieldState>({
		type: "object",
		columnFactory: (name) => jsonb(name),
		schemaFactory: () => {
			const shape: Record<string, z.ZodTypeAny> = {};
			for (const [key, field] of Object.entries(fields)) {
				shape[key] = (field as Field<any>).toZodSchema();
			}
			return z.object(shape);
		},
		operatorSet: objectOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
		nestedFields: fields,
		metadataFactory: (state) => {
			const nested = state.nestedFields as Record<string, Field<any>> | undefined;
			const nestedMetadata: Record<string, any> = {};
			if (nested) {
				for (const [key, field] of Object.entries(nested)) {
					nestedMetadata[key] = (field as Field<any>).getMetadata();
				}
			}
			return {
				type: "object",
				label: state.label,
				description: state.description,
				required: state.notNull ?? false,
				localized: state.localized ?? false,
				readOnly: state.input === false,
				writeOnly: state.output === false,
				nestedFields: nestedMetadata,
				meta: state.admin,
			} as NestedFieldMetadata;
		},
	});
}

import type { Field } from "../field.js";
