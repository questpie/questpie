/**
 * Object Field Factory
 */

import { jsonb, type PgJsonbBuilder } from "drizzle-orm/pg-core";
import { z } from "zod";

import type {
	DefaultFieldState,
	ExtractSelectType,
	FieldState,
} from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import { objectOps } from "../../../fields/operators/builtin.js";
import type { NestedFieldMetadata } from "../../../fields/types.js";

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
 *
 * Delegates to the canonical `ExtractSelectType` so nested field-shaping matches
 * top-level rows: an `outputFalse()` (output:false) or virtual-relation nested
 * field resolves to `never` and is dropped from the object shape, exactly as it
 * is dropped at the collection level. Single-evaluation form — each field's
 * select type is computed once into `M`, then `never` keys are filtered out.
 */
type InferObjectData<TFields extends Record<string, Field<any>>> = {
	[K in keyof TFields]: TFields[K] extends {
		readonly _: infer S extends FieldState;
	}
		? ExtractSelectType<S>
		: unknown;
} extends infer M
	? { [K in keyof M as M[K] extends never ? never : K]: M[K] }
	: never;

export type ObjectFieldState<TData = Record<string, unknown>> =
	Omit<DefaultFieldState, "operators"> & {
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

import type { Field } from "../../../fields/field-class.js";

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
