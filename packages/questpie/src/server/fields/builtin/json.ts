/**
 * JSON Field Type
 *
 * Schema-less JSON field stored as JSONB or JSON.
 * Use when you need flexible, untyped JSON storage.
 * For typed objects, prefer `objectField` or `arrayField`.
 */

import { isNull, isNotNull, sql } from "drizzle-orm";
import { jsonb, json } from "drizzle-orm/pg-core";
import { z } from "zod";
import { defineField } from "../define-field.js";
import type {
	BaseFieldConfig,
	ContextualOperators,
	FieldMetadataBase,
} from "../types.js";
import { getDefaultRegistry } from "../registry.js";

// ============================================================================
// JSON Field Configuration
// ============================================================================

/**
 * JSON field configuration options.
 */
export interface JsonFieldConfig extends BaseFieldConfig {
	/**
	 * Storage mode.
	 * - jsonb: Binary JSON, supports indexing and operators (default)
	 * - json: Text JSON, exact representation
	 * @default "jsonb"
	 */
	mode?: "jsonb" | "json";
}

// ============================================================================
// JSON Field Operators
// ============================================================================

/**
 * Get operators for JSON field.
 * Provides JSONB operators for containment and key operations.
 */
function getJsonOperators(): ContextualOperators {
	return {
		column: {
			// Contains the given key-value pairs (for objects)
			contains: (col, value) =>
				sql`${col} @> ${JSON.stringify(value)}::jsonb`,
			// Is contained by the given value
			containedBy: (col, value) =>
				sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
			// Has the given key (for objects)
			hasKey: (col, value) =>
				sql`${col} ? ${value}`,
			// Has all the given keys
			hasKeys: (col, values) =>
				sql`${col} ?& ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`,
			// Has any of the given keys
			hasAnyKeys: (col, values) =>
				sql`${col} ?| ${sql.raw(`ARRAY[${(values as string[]).map((v) => `'${v}'`).join(",")}]`)}`,
			// Value at path equals
			pathEquals: (col, value) => {
				const { path, val } = value as { path: string[]; val: unknown };
				return sql`${col}#>>'{${sql.raw(path.join(","))}}' = ${val}`;
			},
			// Value at path exists
			pathExists: (col, value) => {
				const path = value as string[];
				return sql`${col}#>'{${sql.raw(path.join(","))}}' IS NOT NULL`;
			},
			// JSON path query (PostgreSQL 12+)
			jsonPath: (col, value) =>
				sql`${col} @@ ${value}::jsonpath`,
			// Equals (exact match)
			eq: (col, value) =>
				sql`${col} = ${JSON.stringify(value)}::jsonb`,
			// Not equals
			ne: (col, value) =>
				sql`${col} != ${JSON.stringify(value)}::jsonb`,
			// Type of JSON value
			typeof: (col, value) => {
				const type = value as string;
				return sql`jsonb_typeof(${col}) = ${type}`;
			},
			// Is empty (empty object, array, or null)
			isEmpty: (col) =>
				sql`(${col} IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) OR ${col} IS NULL)`,
			// Is not empty
			isNotEmpty: (col) =>
				sql`(${col} NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) AND ${col} IS NOT NULL)`,
			isNull: (col) => isNull(col),
			isNotNull: (col) => isNotNull(col),
		},
		jsonb: {
			contains: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(value)}::jsonb`;
			},
			containedBy: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' <@ ${JSON.stringify(value)}::jsonb`;
			},
			hasKey: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ? ${value}`;
			},
			eq: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' = ${JSON.stringify(value)}::jsonb`;
			},
			ne: (col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' != ${JSON.stringify(value)}::jsonb`;
			},
			isEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			},
			isNotEmpty: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			},
			isNull: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			},
			isNotNull: (col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			},
		},
	};
}

// ============================================================================
// JSON Field Definition
// ============================================================================

/**
 * JSON type - any valid JSON value.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/**
 * JSON field factory.
 * Creates a schema-less JSON field.
 *
 * Use this for flexible, untyped JSON storage.
 * For typed structures, prefer `objectField` or `arrayField`.
 *
 * @example
 * ```ts
 * // Flexible metadata
 * const metadata = jsonField();
 *
 * // Settings with json mode (preserves exact representation)
 * const rawData = jsonField({ mode: "json" });
 *
 * // Required JSON field
 * const config = jsonField({ required: true });
 * ```
 */
export const jsonField = defineField<"json", JsonFieldConfig, JsonValue>(
	"json",
	{
		toColumn(name, config) {
			const { mode = "jsonb" } = config;

			let column: any = mode === "json" ? json(name) : jsonb(name);

			// Apply constraints
			if (config.required && config.nullable !== true) {
				column = column.notNull();
			}
			if (config.default !== undefined) {
				const defaultValue =
					typeof config.default === "function"
						? config.default()
						: config.default;
				column = column.default(defaultValue);
			}

			return column;
		},

		toZodSchema(config) {
			// Schema-less: accept any valid JSON
			const jsonSchema: z.ZodType<JsonValue> = z.lazy(() =>
				z.union([
					z.string(),
					z.number(),
					z.boolean(),
					z.null(),
					z.array(jsonSchema),
					z.record(jsonSchema),
				]),
			);

			// Nullability
			if (!config.required && config.nullable !== false) {
				return jsonSchema.nullish() as any;
			}

			return jsonSchema as any;
		},

		getOperators() {
			return getJsonOperators();
		},

		getMetadata(config): FieldMetadataBase {
			return {
				type: "json",
				label: config.label,
				description: config.description,
				required: config.required ?? false,
				localized: config.localized ?? false,
				unique: config.unique ?? false,
				searchable: config.searchable ?? false,
				readOnly: config.input === false,
				writeOnly: config.output === false,
			};
		},
	},
);

// Register in default registry
getDefaultRegistry().register("json", jsonField);
