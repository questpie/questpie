/**
 * Drizzle to Zod Schema Transformer
 *
 * Provides typesafe utilities to transform Drizzle column definitions into Zod schemas.
 * Maintains full type inference and supports all PostgreSQL column types.
 *
 * @example
 * ```ts
 * import { varchar, integer, boolean } from "drizzle-orm/pg-core";
 * import { drizzleColumnsToZod, createZodSchema } from "./drizzle-to-zod";
 *
 * const columns = {
 *   name: varchar("name", { length: 255 }).notNull(),
 *   age: integer("age"),
 *   isActive: boolean("is_active").default(true),
 * };
 *
 * const schema = drizzleColumnsToZod(columns);
 * // Type: z.ZodObject<{ name: z.ZodString, age: z.ZodNumber.optional(), isActive: z.ZodBoolean.optional() }>
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
	PgInteger,
	PgInterval,
	PgJson,
	PgJsonb,
	PgNumeric,
	PgReal,
	PgSerial,
	PgSmallInt,
	PgSmallSerial,
	PgText,
	PgTime,
	PgTimestamp,
	PgUUID,
	PgVarchar,
	PgTable,
} from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * Type helpers for inferring Zod schemas from Drizzle columns
 */

// Get table columns without reserved keys
type TableColumns<T extends PgTable<any>> = ReturnType<typeof getColumns<T>>;

// Base Zod type inference from Drizzle column types
type DrizzleColumnToZodType<T extends PgColumn> =
	T extends PgColumn<infer TConfig>
		? TConfig["data"] extends string
			? z.ZodString
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
 * Extract Zod schema for varchar/char columns
 */
function varcharToZod(column: PgVarchar<any> | PgChar<any>): z.ZodString {
	let schema = z.string();

	// Add max length constraint if specified
	const config = getColumnConfig(column);
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
 */
function dateToZod(column: PgDate<any>): z.ZodDate | z.ZodString {
	// Check dataType in config
	const config = getColumnConfig(column);
	const dataType = config.dataType;

	if (dataType?.includes("date") && dataType?.includes("object")) {
		return z.date();
	}

	// Default to string
	return z.string();
}

/**
 * Extract Zod schema for timestamp columns
 */
function timestampToZod(column: PgTimestamp<any>): z.ZodDate | z.ZodString {
	// Check dataType in config
	const config = getColumnConfig(column);
	const dataType = config.dataType;

	if (dataType?.includes("date") && dataType?.includes("object")) {
		return z.date();
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

	// Apply nullability and optional constraints
	if (isNotNull(column)) {
		// Column is required
		return baseSchema;
	}

	// Column is optional (nullable or has default)
	if (hasDefault(column)) {
		// Has default value - make it nullable and optional
		// (can be omitted or set to null, DB will use default)
		return baseSchema.nullable().optional();
	}

	// Nullable column (no default)
	return baseSchema.nullable();
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

type CreateInsertSchemaOpts<TTable extends PgTable<any>> = {
	/** Fields to exclude from the schema */
	exclude?: { [K in keyof TableColumns<TTable>]?: true };
	/** Fields to make optional (even if notNull in DB) */
	optional?: { [K in keyof TableColumns<TTable>]?: true };
	/** Custom refinements or transformations per field */
	refine?: Partial<{
		[K in keyof TableColumns<TTable>]: (
			schema: ColumnToZodType<TableColumns<TTable>[K]>,
		) => z.ZodTypeAny;
	}>;
};

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

		// Force optional if specified
		if (optional.has(key)) {
			// If it's nullable, make it optional too
			if (schema instanceof z.ZodNullable) {
				schema = schema.optional();
			} else if (!(schema instanceof z.ZodOptional)) {
				schema = schema.optional();
			}
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
		// If it's nullable, make it optional too
		if (schema instanceof z.ZodNullable) {
			schema = schema.optional();
		} else if (!(schema instanceof z.ZodOptional)) {
			schema = schema.optional();
		}

		shape[key] = schema;
	}

	return z.object(shape) as any;
}
