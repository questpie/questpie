/**
 * Object Field Type
 *
 * Structured object field stored as JSONB.
 * Supports nested field definitions with type inference.
 */

import { sql } from "drizzle-orm";
import { json, jsonb } from "drizzle-orm/pg-core";
import { z } from "zod";
import { field } from "../field.js";
import type {
	AnyFieldDefinition,
	BaseFieldConfig,
	FieldDefinition,
	NestedFieldMetadata,
} from "../types.js";
import { operator } from "../types.js";

// ============================================================================
// Object Field Meta (augmentable by admin)
// ============================================================================

/**
 * Object field metadata - augmentable by external packages.
 *
 * @example Admin augmentation:
 * ```ts
 * declare module "questpie" {
 *   interface ObjectFieldMeta {
 *     admin?: {
 *       collapsible?: boolean;
 *       defaultCollapsed?: boolean;
 *       displayAs?: "card" | "section" | "inline";
 *     }
 *   }
 * }
 * ```
 */
export interface ObjectFieldMeta {
	/** Phantom property to prevent interface collapse - enables module augmentation */
	_?: never;
}

// ============================================================================
// Object Field Configuration
// ============================================================================

/**
 * Object field configuration options.
 */
export interface ObjectFieldConfig extends BaseFieldConfig {
	/** Field-specific metadata, augmentable by external packages. */
	meta?: ObjectFieldMeta;
	/**
	 * Nested field definitions.
	 * Can be:
	 * - Direct field definitions map
	 * - Factory function for deferred definition (avoids circular refs)
	 */
	fields:
		| Record<string, AnyFieldDefinition>
		| (() => Record<string, AnyFieldDefinition>);

	/**
	 * Storage mode.
	 * - jsonb: Binary JSON, supports indexing and operators (default)
	 * - json: Text JSON, exact representation
	 * @default "jsonb"
	 */
	mode?: "jsonb" | "json";
}

// ============================================================================
// Object Field Operators
// ============================================================================

/**
 * Get operators for object field.
 * Provides JSONB operators for containment and key operations.
 */
function getObjectOperators() {
	return {
		column: {
			// Contains the given key-value pairs
			contains: operator<unknown, unknown>(
				(col, value) => sql`${col} @> ${JSON.stringify(value)}::jsonb`,
			),
			// Is contained by the given object
			containedBy: operator<unknown, unknown>(
				(col, value) => sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
			),
			// Has the given key
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
			// JSON path query
			jsonPath: operator<string, unknown>(
				(col, value) => sql`${col} @@ ${value}::jsonpath`,
			),
			// Is empty object
			isEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} = '{}'::jsonb OR ${col} IS NULL)`,
			),
			// Is not empty
			isNotEmpty: operator<boolean, unknown>(
				(col) => sql`(${col} != '{}'::jsonb AND ${col} IS NOT NULL)`,
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
			hasKeys: operator<string[], unknown>((col, values, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`${col}#>'{${sql.raw(path)}}' ?& ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`;
			}),
			isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' = '{}'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
			}),
			isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
				const path = ctx.jsonbPath?.join(",") ?? "";
				return sql`(${col}#>'{${sql.raw(path)}}' != '{}'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
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
// Object Field Definition
// ============================================================================

/**
 * Resolve fields from config (handles factory functions).
 */
function resolveFields(
	fields:
		| Record<string, AnyFieldDefinition>
		| (() => Record<string, AnyFieldDefinition>),
): Record<string, AnyFieldDefinition> {
	return typeof fields === "function" ? fields() : fields;
}

/**
 * Object field factory.
 * Creates an object field with nested field definitions.
 *
 * @example
 * ```ts
 * // Address object
 * const address = objectField({
 *   fields: {
 *     street: textField({ required: true }),
 *     city: textField({ required: true }),
 *     zipCode: textField({ pattern: /^\d{5}$/ }),
 *     country: textField({ default: "US" }),
 *   },
 * });
 *
 * // Metadata object with optional fields
 * const metadata = objectField({
 *   fields: {
 *     views: numberField({ default: 0 }),
 *     lastAccessed: datetimeField(),
 *     tags: arrayField({ of: textField() }),
 *   },
 * });
 * ```
 */
export const objectField = field<
	ObjectFieldConfig,
	Record<string, unknown>
>()({
	type: "object" as const,
	_value: undefined as unknown as Record<string, unknown>,
	toColumn(name: string, config: ObjectFieldConfig) {
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

	toZodSchema(config: ObjectFieldConfig) {
		const nestedFields = resolveFields(config.fields);

		// Build Zod object schema from nested field definitions
		const shape: Record<string, z.ZodTypeAny> = {};

		for (const [fieldName, fieldDef] of Object.entries(nestedFields)) {
			shape[fieldName] = fieldDef.toZodSchema();
		}

		const schema = z.object(shape);

		// Nullability
		if (!config.required && config.nullable !== false) {
			return schema.nullish();
		}

		return schema;
	},

	getOperators<TApp>(config: ObjectFieldConfig) {
		return getObjectOperators();
	},

	getMetadata(config: ObjectFieldConfig): NestedFieldMetadata {
		const nestedFields = resolveFields(config.fields);

		// Build nested metadata
		const nestedMetadata: Record<string, any> = {};
		for (const [fieldName, fieldDef] of Object.entries(nestedFields)) {
			nestedMetadata[fieldName] = fieldDef.getMetadata();
		}

		return {
			type: "object",
			label: config.label,
			description: config.description,
			required: config.required ?? false,
			localized: config.localized ?? false,
			readOnly: config.input === false,
			writeOnly: config.output === false,
			nestedFields: nestedMetadata,
			meta: config.meta,
		};
	},
});

// Register in default registry
// ObjectFieldConfig is now compatible with AnyFieldDefinition (no cast needed)
