/**
 * JSON Field Factory
 */

import {
	jsonb,
	type PgJsonbBuilder,
	json as pgJson,
} from "drizzle-orm/pg-core";
import { z } from "zod";

import type { DefaultFieldState } from "../../../fields/field-class-types.js";
import { field } from "../../../fields/field-class.js";
import { fieldType, wrapFieldComplete } from "../../../fields/field-type.js";
import { basicOps } from "../../../fields/operators/builtin.js";

declare global {
	namespace Questpie {
		interface JsonFieldMeta {}
	}
}

export interface JsonFieldMeta extends Questpie.JsonFieldMeta {
	_?: never;
}

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** Recursive Zod schema for schema-less JSON fields (replaces `z.any()`). */
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

export type JsonFieldState<TData extends JsonValue = JsonValue> = Omit<
	DefaultFieldState,
	"operators"
> & {
	type: "json";
	data: TData;
	column: PgJsonbBuilder;
	operators: typeof basicOps;
};

/**
 * Create a schema-less JSON field (stored as JSONB by default).
 *
 * For typed objects, prefer `f.object()`. Pass a type argument to narrow the
 * stored value to a specific JSON shape (unions, `Record<string, T>`, etc.):
 * `f.json<{ k: number }>()`.
 *
 * @param config - Optional configuration
 *
 * @example
 * ```ts
 * metadata: f.json()
 * rawData: f.json({ mode: "json" })
 * settings: f.json<{ theme: "light" | "dark" }>()
 * ```
 */
export function json<TData extends JsonValue = JsonValue>(config?: {
	mode?: "jsonb" | "json";
}): Field<JsonFieldState<TData>> {
	const mode = config?.mode ?? "jsonb";

	return wrapFieldComplete(field<JsonFieldState<TData>>({
		type: "json",
		columnFactory: (name) => (mode === "json" ? pgJson(name) : jsonb(name)),
		schemaFactory: () => jsonValueSchema,
		operatorSet: basicOps,
		notNull: false,
		hasDefault: false,
		localized: false,
		virtual: false,
		input: true,
		output: true,
		isArray: false,
	}), jsonFieldType.methods, {}) as any;
}

import type { Field } from "../../../fields/field-class.js";

// ---- fieldType() definition (QUE-265) ----

export const jsonFieldType = fieldType("json", {
	create: (config?: { mode?: "jsonb" | "json" }) => {
		const mode = config?.mode ?? "jsonb";

		return {
			type: "json",
			columnFactory: (name: string) =>
				mode === "json" ? pgJson(name) : jsonb(name),
			schemaFactory: () => jsonValueSchema,
			operatorSet: basicOps,
			notNull: false,
			hasDefault: false,
			localized: false,
			virtual: false,
			input: true,
			output: true,
			isArray: false,
		};
	},
});
