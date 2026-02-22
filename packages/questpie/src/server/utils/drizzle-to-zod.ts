/**
 * Drizzle to Zod Schema Transformer
 *
 * Provides typesafe utilities to transform Drizzle column definitions into Zod schemas.
 * Maintains full type inference and supports all PostgreSQL column types.
 *
 * @example
 * ```ts
 * import { varchar, integer, boolean, pgEnum } from "drizzle-orm/pg-core";
 * import { drizzleColumnsToZod, createZodSchema } from "./drizzle-to-zod.js";
 *
 * const columns = {
 *   name: varchar("name", { length: 255 }).notNull(),
 *   age: integer("age"),
 *   isActive: boolean("is_active").default(true),
 * };
 *
 * const schema = drizzleColumnsToZod(columns);
 * // Type: z.ZodObject<{ name: z.ZodString, age: z.ZodNumber.optional(), isActive: z.ZodBoolean.optional() }>
 *
 * // Using pgEnum
 * const statusEnum = pgEnum("status", ["draft", "published", "archived"]);
 * const table = pgTable("posts", {
 *   status: statusEnum("status").notNull(),
 *   title: varchar("title", { length: 255 }).notNull(),
 * });
 *
 * const postSchema = drizzleColumnsToZod(table);
 * // Type: z.ZodObject<{ status: z.ZodEnum<["draft", "published", "archived"]>, title: z.ZodString }>
 * ```
 */

import { getColumns } from "drizzle-orm";
import type {
	PgBigInt53,
	PgBigInt64,
	PgBigSerial53,
	PgBigSerial64,
	PgBoolean,
	PgChar,
	PgColumn,
	PgDate,
	PgDoublePrecision,
	PgEnumColumn,
	PgInteger,
	PgInterval,
	PgJson,
	PgJsonb,
	PgNumeric,
	PgReal,
	PgSerial,
	PgSmallInt,
	PgSmallSerial,
	PgTable,
	PgText,
	PgTime,
	PgTimestamp,
	PgUUID,
	PgVarchar,
} from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * Type helpers for inferring Zod schemas from Drizzle columns
 */

// Get table columns without reserved keys
type TableColumns<T extends PgTable<any>> = ReturnType<typeof getColumns<T>>;

type EnumLikeFromArray<T extends string[]> = {
	[K in T[number]]: K;
};

// Base Zod type inference from Drizzle column types
type DrizzleColumnToZodType<T extends PgColumn> =
	T extends PgColumn<infer TConfig>
		? TConfig["data"] extends string
			? TConfig["enumValues"] extends string[]
				? z.ZodEnum<EnumLikeFromArray<TConfig["enumValues"]>> // Enum of specific strings
				: z.ZodString // General string type
			: TConfig["data"] extends number
				? z.ZodNumber
				: TConfig["data"] extends boolean
					? z.ZodBoolean
					: TConfig["data"] extends Date
						? z.ZodDate
						: TConfig["data"] extends bigint
							? z.ZodBigInt
							: TConfig["data"] extends object
								? z.ZodType<TConfig["data"]>
								: z.ZodTypeAny
		: z.ZodTypeAny;

// Check if column is nullable (not notNull)
type IsNullable<T extends PgColumn> = T["_"]["notNull"] extends true
	? false
	: true;

// Check if column has default
type HasDefault<T extends PgColumn> = T["_"]["hasDefault"] extends true
	? true
	: false;

// Apply nullability and optionality to base type
type ApplyModifiers<
	TBase extends z.ZodTypeAny,
	TColumn extends PgColumn,
> = IsNullable<TColumn> extends true
	? HasDefault<TColumn> extends true
		? z.ZodOptional<z.ZodNullable<TBase>>
		: z.ZodNullable<TBase>
	: TBase;

// Final Zod type for a column
type ColumnToZodType<T extends PgColumn> = ApplyModifiers<
	DrizzleColumnToZodType<T>,
	T
>;

// Map record of columns to record of Zod types
type ColumnsToZodShape<TColumns extends Record<string, PgColumn>> = {
	[K in keyof TColumns]: ColumnToZodType<TColumns[K]>;
};

/**
 * Type guard to check if column has notNull constraint
 */
function isNotNull(column: PgColumn): boolean {
	// Drizzle stores this in the config object
	return (column as any).config?.notNull === true;
}

/**
 * Type guard to check if column has default value
 */
function hasDefault(column: PgColumn): boolean {
	// Drizzle stores this in the config object
	return (column as any).config?.hasDefault === true;
}

/**
 * Get column config
 */
function getColumnConfig(column: PgColumn): any {
	return (column as any).config || {};
}

/**
 * Extract Zod schema for pgEnum columns
 */
function enumToZod(column: PgEnumColumn<any>): z.ZodEnum<any> {
	const config = getColumnConfig(column);

	// Get enum values from the enum definition
	// In pgEnum columns, values are stored in config.enum.enumValues
	const enumFn = config.enum;
	const enumValues = enumFn?.enumValues;

	if (!enumValues || !Array.isArray(enumValues) || enumValues.length === 0) {
		throw new Error("pgEnum column must have enum values defined");
	}

	return z.enum(enumValues as [string, ...string[]]);
}

/**
 * Extract Zod schema for varchar/char columns
 */
function varcharToZod(
	column: PgVarchar<any> | PgChar<any>,
): z.ZodString | z.ZodEnum<any> {
	const config = getColumnConfig(column);

	// Check if enum values are specified
	if (
		config.enumValues &&
		Array.isArray(config.enumValues) &&
		config.enumValues.length > 0
	) {
		return z.enum(config.enumValues as [string, ...string[]]);
	}

	let schema = z.string();

	// Add max length constraint if specified
	if (config.length && typeof config.length === "number") {
		schema = schema.max(config.length);
	}

	return schema;
}

/**
 * Extract Zod schema for text columns
 */
function textToZod(_column: PgText<any>): z.ZodString {
	return z.string();
}

/**
 * Extract Zod schema for integer columns
 */
function integerToZod(
	_column:
		| PgInteger<any>
		| PgSmallInt<any>
		| PgSerial<any>
		| PgSmallSerial<any>,
): z.ZodNumber {
	return z.number().int();
}

/**
 * Extract Zod schema for bigint columns
 */
function bigintToZod(
	column:
		| PgBigInt53<any>
		| PgBigInt64<any>
		| PgBigSerial53<any>
		| PgBigSerial64<any>,
): z.ZodNumber | z.ZodBigInt {
	// Check columnType and dataType to determine mode
	const config = getColumnConfig(column);
	const columnType = config.columnType;
	const dataType = config.dataType;

	// Check if it's number mode (int53) or bigint mode (int64)
	if (
		columnType === "PgBigInt53" ||
		columnType === "PgBigSerial53" ||
		dataType?.includes("int53")
	) {
		return z.number().int();
	}

	// Default to bigint for int64
	return z.bigint();
}

/**
 * Extract Zod schema for numeric/decimal columns
 */
function numericToZod(_column: PgNumeric<any>): z.ZodString {
	// Numeric is typically handled as string in Drizzle to preserve precision
	return z.string();
}

/**
 * Extract Zod schema for float columns
 */
function floatToZod(
	_column: PgReal<any> | PgDoublePrecision<any>,
): z.ZodNumber {
	return z.number();
}

/**
 * Extract Zod schema for boolean columns
 */
function booleanToZod(_column: PgBoolean<any>): z.ZodBoolean {
	return z.boolean();
}

/**
 * Extract Zod schema for date columns
 * Uses z.coerce.date() to accept both Date objects and ISO strings from JSON
 */
function dateToZod(column: PgDate<any>): z.ZodType<Date> | z.ZodString {
	// Check dataType in config
	const config = getColumnConfig(column);
	const dataType = config.dataType;

	if (dataType?.includes("date") && dataType?.includes("object")) {
		// Use coerce to accept ISO strings from JSON and convert to Date
		return z.coerce.date();
	}

	// Default to string
	return z.string();
}

/**
 * Extract Zod schema for timestamp columns
 * Uses z.coerce.date() to accept both Date objects and ISO strings from JSON
 */
function timestampToZod(
	column: PgTimestamp<any>,
): z.ZodType<Date> | z.ZodString {
	// Check dataType in config
	const config = getColumnConfig(column);
	const dataType = config.dataType;

	if (dataType?.includes("date") && dataType?.includes("object")) {
		// Use coerce to accept ISO strings from JSON and convert to Date
		return z.coerce.date();
	}

	// Default to string
	return z.string();
}

/**
 * Extract Zod schema for time columns
 */
function timeToZod(_column: PgTime<any>): z.ZodString {
	return z.string();
}

/**
 * Extract Zod schema for interval columns
 */
function intervalToZod(_column: PgInterval<any>): z.ZodString {
	return z.string();
}

/**
 * Extract Zod schema for UUID columns
 */
function uuidToZod(_column: PgUUID<any>): z.ZodString {
	// In Zod v4, uuid() validation is built-in
	return z.string().refine((val) => {
		const uuidRegex =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
		return uuidRegex.test(val);
	}, "Invalid UUID format");
}

/**
 * Extract Zod schema for JSON/JSONB columns
 */
function jsonToZod<T = unknown>(
	_column: PgJson<any> | PgJsonb<any>,
): z.ZodType<T> {
	return z.any() as z.ZodType<T>;
}

/**
 * Convert a single Drizzle column to Zod schema
 */
export function drizzleColumnToZod(column: any): z.ZodTypeAny {
	let baseSchema: z.ZodTypeAny;

	// Get config to determine column type
	const config = getColumnConfig(column);
	const columnType = config.columnType || column.constructor.name;

	switch (columnType) {
		case "PgEnum":
		case "PgEnumColumn":
			baseSchema = enumToZod(column as any);
			break;
		case "PgVarchar":
		case "PgChar":
			baseSchema = varcharToZod(column as any);
			break;
		case "PgText":
			baseSchema = textToZod(column as any);
			break;
		case "PgInteger":
		case "PgSmallInt":
		case "PgSerial":
		case "PgSmallSerial":
			baseSchema = integerToZod(column as any);
			break;
		case "PgBigInt53":
		case "PgBigInt64":
		case "PgBigSerial53":
		case "PgBigSerial64":
			baseSchema = bigintToZod(column as any);
			break;
		case "PgNumeric":
			baseSchema = numericToZod(column as any);
			break;
		case "PgReal":
		case "PgDoublePrecision":
			baseSchema = floatToZod(column as any);
			break;
		case "PgBoolean":
			baseSchema = booleanToZod(column as any);
			break;
		case "PgDate":
			baseSchema = dateToZod(column as any);
			break;
		case "PgTimestamp":
			baseSchema = timestampToZod(column as any);
			break;
		case "PgTime":
			baseSchema = timeToZod(column as any);
			break;
		case "PgInterval":
			baseSchema = intervalToZod(column as any);
			break;
		case "PgUUID":
			baseSchema = uuidToZod(column as any);
			break;
		case "PgJson":
		case "PgJsonb":
			baseSchema = jsonToZod(column as any);
			break;
		default:
			// Fallback to any for unknown types
			baseSchema = z.any();
	}

	// Apply nullability and optional constraints for INSERT operations
	// Note: This generates schemas suitable for create operations where:
	// - Fields with defaults can be omitted (DB supplies default)
	// - Nullable fields can be null or omitted
	// - Only notNull fields WITHOUT defaults are truly required

	const columnHasDefault = hasDefault(column);
	const columnIsNotNull = isNotNull(column);

	if (columnHasDefault) {
		// Has default value - can be omitted, DB will use default
		// For notNull with default: optional (can omit, but if provided must be valid)
		// For nullable with default: nullish (can omit, null, or valid value)
		if (columnIsNotNull) {
			return baseSchema.optional();
		}
		return baseSchema.nullish();
	}

	if (columnIsNotNull) {
		// Required field (no default, not nullable)
		return baseSchema;
	}

	// Nullable column without default - can be null or omitted
	return baseSchema.nullish();
}

/**
 * Transform an object of Drizzle columns into a Zod schema object
 *
 * @example
 * ```ts
 * const myTable = pgTable("users", {
 *   name: varchar("name", { length: 255 }).notNull(),
 *   age: integer("age"),
 *   email: varchar("email", { length: 255 }).notNull(),
 * });
 *
 * const schema = drizzleColumnsToZod(myTable);
 * // Type: z.ZodObject<{
 * //   name: z.ZodString,
 * //   age: z.ZodNullable<z.ZodNumber>,
 * //   email: z.ZodString
 * // }>
 * ```
 */
export function drizzleColumnsToZod<TTable extends PgTable<any>>(
	table: TTable,
): z.ZodObject<ColumnsToZodShape<TableColumns<TTable>>> {
	const shape: Record<string, z.ZodTypeAny> = {};

	// Extract columns from table, filtering out reserved keys
	for (const [key, column] of Object.entries(getColumns(table))) {
		shape[key] = drizzleColumnToZod(column);
	}

	return z.object(shape) as z.ZodObject<
		ColumnsToZodShape<TableColumns<TTable>>
	>;
}

/**
 * Helper to create a Zod schema from collection fields (excluding system fields)
 *
 * @example
 * ```ts
 * const myTable = pgTable("users", {
 *   id: uuid("id").primaryKey(),
 *   name: varchar("name", { length: 255 }).notNull(),
 *   age: integer("age"),
 *   createdAt: timestamp("created_at").notNull(),
 * });
 *
 * // Create validation schema (excluding id, createdAt, updatedAt, etc.)
 * const insertSchema = createInsertSchema(myTable, {
 *   exclude: ["id", "createdAt"]
 * });
 *
 * // Use for validation
 * const validData = insertSchema.parse({ name: "John", age: 30 });
 * ```
 */
export function createInsertSchema<
	TTable extends PgTable<any>,
	const TExclude extends { [K in keyof TableColumns<TTable>]?: true },
	const TOptional extends { [K in keyof TableColumns<TTable>]?: true },
>(
	table: TTable,
	options?: {
		/** Fields to exclude from the schema */
		exclude?: TExclude;
		/** Fields to make optional (even if notNull in DB) */
		optional?: TOptional;
		/** Custom refinements or transformations per field */
		refine?: Partial<{
			[K in keyof TableColumns<TTable>]: (
				schema: ColumnToZodType<TableColumns<TTable>[K]>,
			) => z.ZodTypeAny;
		}>;
	},
): z.ZodObject<{
	[K in keyof TableColumns<TTable>]: TExclude extends { [P in K]: true }
		? never
		: TOptional extends { [P in K]: true }
			? z.ZodOptional<ColumnToZodType<TableColumns<TTable>[K]>>
			: ColumnToZodType<TableColumns<TTable>[K]>;
}> {
	const exclude = new Set(Object.keys(options?.exclude || {}));
	const optional = new Set(Object.keys(options?.optional || {}));
	const refine = options?.refine || {};

	const shape: Record<string, z.ZodTypeAny> = {};

	// Extract columns from table, filtering out reserved keys
	for (const [key, column] of Object.entries(getColumns(table))) {
		// Skip excluded fields
		if (exclude.has(key)) {
			continue;
		}

		// Get base schema
		let schema = drizzleColumnToZod(column);

		// Apply custom refinement if provided
		if (key in refine) {
			schema = (refine as any)[key](schema);
		}

		// Force optional if specified (additional to defaults)
		if (optional.has(key) && !(schema instanceof z.ZodOptional)) {
			schema = schema.optional();
		}

		shape[key] = schema;
	}

	return z.object(shape) as any;
}

/**
 * Helper to create an update schema (all fields optional)
 *
 * @example
 * ```ts
 * const myTable = pgTable("users", {
 *   id: uuid("id").primaryKey(),
 *   name: varchar("name", { length: 255 }).notNull(),
 *   createdAt: timestamp("created_at").notNull(),
 * });
 *
 * const updateSchema = createUpdateSchema(myTable, {
 *   exclude: ["id", "createdAt"]
 * });
 *
 * // All fields are optional for updates
 * const updates = updateSchema.parse({ name: "Jane" }); // other fields not required
 * ```
 */
export function createUpdateSchema<
	TTable extends PgTable<any>,
	const TExclude extends { [K in keyof TableColumns<TTable>]?: true },
>(
	table: TTable,
	options?: {
		/** Fields to exclude from the schema */
		exclude?: TExclude;
		/** Custom refinements or transformations per field */
		refine?: Partial<{
			[K in keyof TableColumns<TTable>]: (
				schema: ColumnToZodType<TableColumns<TTable>[K]>,
			) => z.ZodTypeAny;
		}>;
	},
): z.ZodObject<{
	[K in keyof TableColumns<TTable>]: TExclude extends { [P in K]: true }
		? never
		: z.ZodOptional<ColumnToZodType<TableColumns<TTable>[K]>>;
}> {
	const exclude = new Set(Object.keys(options?.exclude || {}));
	const refine = options?.refine || {};

	const shape: Record<string, z.ZodTypeAny> = {};

	// Extract columns from table, filtering out reserved keys
	for (const [key, column] of Object.entries(getColumns(table))) {
		// Skip excluded fields
		if (exclude.has(key)) {
			continue;
		}

		// Get base schema
		let schema = drizzleColumnToZod(column);

		// Apply custom refinement if provided
		if (key in refine) {
			schema = (refine as any)[key](schema);
		}

		// Make everything optional for updates
		// Schema might already be optional (from nullish()) or nullable
		// We need to ensure it's optional without double-wrapping
		if (!(schema instanceof z.ZodOptional)) {
			schema = schema.optional();
		}

		shape[key] = schema;
	}

	return z.object(shape) as any;
}
