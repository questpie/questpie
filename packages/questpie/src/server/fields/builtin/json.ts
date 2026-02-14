/**
 * JSON Field Type
 *
 * Schema-less JSON field stored as JSONB or JSON.
 * Use when you need flexible, untyped JSON storage.
 * For typed objects, prefer `objectField` or `arrayField`.
 */

import { sql } from "drizzle-orm";
import { json, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type { BaseFieldConfig, FieldMetadataBase } from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// JSON Field Meta (augmentable by admin)
// ============================================================================

/**
 * JSON field metadata - augmentable by external packages.
 */
export interface JsonFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// JSON Field Configuration
// ============================================================================

/**
 * JSON field configuration options.
 */
export interface JsonFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: JsonFieldMeta;
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
function getJsonOperators() {
	return {
		column: {
			// Contains the given key-value pairs (for objects)
			contains: operator<unknown, unknown>(
				(col, value) => sql`${col} @> ${JSON.stringify(value)}::jsonb`,
			),
			// Is contained by the given value
			containedBy: operator<unknown, unknown>(
				(col, value) => sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
			),
			// Has the given key (for objects)
			hasKey: operator<string, unknown>((col, value) => sql`${col} ? ${value}`),
			// Has all the given keys
			hasKeys: operator<string[], unknown>(
				(col, values) =>
					sql`${col} ?& ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`,
			),
			// Has any of the given keys
			hasAnyKeys: operator<string[], unknown>(
				(col, values) =>
					sql`${col} ?| ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`,
			),
			// Value at path equals
			pathEquals: operator<{ path: string[]; val: unknown }, unknown>(
				(col, value) => {
					return sql`${col}#>>'{${sql.raw(value.path.join(","))}}' = ${value.val}`;
				},
			),
			// Value at path exists
			pathExists: operator<string[], unknown>((col, value) => {
				return sql`${col}#>'{${sql.raw(value.join(","))}}' IS NOT NULL`;
			}),
			// JSON path query (PostgreSQL 12+)
			jsonPath: operator<string, unknown>(
				(col, value) => sql`${col} @@ ${value}::jsonpath`,
			),
			// Equals (exact match)
			eq: operator<unknown, unknown>(
				(col, value) => sql`${col} = ${JSON.stringify(value)}::jsonb`,
			),
			// Not equals
			ne: operator<unknown, unknown>(
				(col, value) => sql`${col} != ${JSON.stringify(value)}::jsonb`,
			),
			// Type of JSON value
			typeof: operator<string, unknown>((col, value) => {
				return sql`jsonb_typeof(${col}) = ${value}`;
			}),
			// Is empty (empty object, array, or null)
			isEmpty: operator<boolean, unknown>(
				(col) =>
					sql`(${col} IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) OR ${col} IS NULL)`,
			),
			// Is not empty
			isNotEmpty: operator<boolean, unknown>(
				(col) =>
					sql`(${col} NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) AND ${col} IS NOT NULL)`,
			),
			isNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
			),
			isNotNull: operator<boolean, unknown>((col, value) =>
				value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
			),
		},
		jsonb: {
			contains: operator<unknown, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(value)}::jsonb`;
			}),
			containedBy: operator<unknown, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' <@ ${JSON.stringify(value)}::jsonb`;
			}),
			hasKey: operator<string, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ? ${value}`;
			}),
			eq: operator<unknown, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' = ${JSON.stringify(value)}::jsonb`;
			}),
			ne: operator<unknown, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' != ${JSON.stringify(value)}::jsonb`;
			}),
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' NOT IN ('[]'::jsonb, '{}'::jsonb, 'null'::jsonb) AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
			}),
			isNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`;
			}),
			isNotNull: operator<boolean, unknown>((col, value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return value
					? sql`${col}#>'{${sql.raw(path)}}' IS NOT NULL`
					: sql`${col}#>'{${sql.raw(path)}}' IS NULL`;
			}),
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
export const jsonField = field<JsonFieldConfig, JsonValue>()({
	type: "json" as const,
	_value: undefined as unknown as JsonValue,
	toColumn(name: string, config: JsonFieldConfig) {
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

	toZodSchema(config: JsonFieldConfig) {
		// Schema-less: accept any valid JSON
		// Use z.any() for simplicity since JSON can be anything
		const jsonSchema = z.any() as z.ZodType<JsonValue>;

		// Nullability
		if (!config.required && config.nullable !== false) {
			return jsonSchema.nullish() as any;
		}

		return jsonSchema as any;
	},

	getOperators<TApp>(config: JsonFieldConfig) {
		return getJsonOperators();
	},

	getMetadata(config: JsonFieldConfig): FieldMetadataBase {
		return {
			type: "json",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			meta: config.meta,
		};
	},
});

// Register in default registry
