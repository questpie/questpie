/**
 * Object Field Factory
 */

import { jsonb, type PgJsonbBuilder } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState, FieldState } from "../field-class-types.js";
import { field } from "../field-class.js";
import { fieldType, wrapFieldComplete } from "../field-type.js";
import { objectOps } from "../operators/builtin.js";
import type { NestedFieldMetadata } from "../types.js";

declare global {
	namespace Questpie {
		interface ObjectFieldMeta {}
	}
}

export interface ObjectFieldMeta extends Questpie.ObjectFieldMeta {
	_?: never;
}

/**
 * Infer the data type from nested field definitions.
 * Resolves each field's notNull + data to produce the typed object shape.
 */
type InferObjectData<TFields extends Record<string, Field<any>>> = {
	[K in keyof TFields]: TFields[K] extends {
		readonly _: infer S extends FieldState;
	}
		? S extends { notNull: true }
			? S["data"]
			: S["data"] | null
		: unknown;
};

export type ObjectFieldState<TData = Record<string, unknown>> =
	DefaultFieldState & {
		type: "object";
		data: TData;
		column: PgJsonbBuilder;
		operators: typeof objectOps;
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
export function object<TFields extends Record<string, Field<any>>>(
	fields: TFields,
): Field<ObjectFieldState<InferObjectData<TFields>>> {
	return wrapFieldComplete(field<ObjectFieldState<InferObjectData<TFields>>>({
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
			const nested = state.nestedFields as
				| Record<string, Field<any>>
				| undefined;
			const nestedMetadata: Record<string, any> = {};
			if (nested) {
				for (const [key, field] of Object.entries(nested)) {
					nestedMetadata[key] = (field as Field<any>).getMetadata();
				}
			}
			const result: NestedFieldMetadata = {
				type: "object",
				label: state.label,
				description: state.description,
				required: state.notNull ?? false,
				localized: state.localized ?? false,
				readOnly: state.input === false,
				writeOnly: state.output === false,
				nestedFields: nestedMetadata,
				meta: state.extensions?.admin as any,
			};
			if (state.extensions?.form) {
				(result as any).form = state.extensions.form;
			}
			return result;
		},
	}), objectFieldType.methods, {}) as any;
}

import type { Field } from "../field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const objectFieldType = fieldType("object", {
	create: (fields: Record<string, Field<any>>) => ({
		type: "object",
		columnFactory: (name: string) => jsonb(name),
		schemaFactory: () => {
			const shape: Record<string, z.ZodTypeAny> = {};
			for (const [key, f] of Object.entries(fields)) {
				shape[key] = (f as Field<any>).toZodSchema();
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
		metadataFactory: (state: any) => {
			const nested = state.nestedFields as
				| Record<string, Field<any>>
				| undefined;
			const nestedMetadata: Record<string, any> = {};
			if (nested) {
				for (const [key, f] of Object.entries(nested)) {
					nestedMetadata[key] = (f as Field<any>).getMetadata();
				}
			}
			const result: NestedFieldMetadata = {
				type: "object",
				label: state.label,
				description: state.description,
				required: state.notNull ?? false,
				localized: state.localized ?? false,
				readOnly: state.input === false,
				writeOnly: state.output === false,
				nestedFields: nestedMetadata,
				meta: state.extensions?.admin as any,
			};
			if (state.extensions?.form) {
				(result as any).form = state.extensions.form;
			}
			return result;
		},
	}),
});
