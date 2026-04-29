/**
 * Builtin Operator Sets
 *
 * Pre-defined operator sets for all builtin field types.
 * Uses operatorSet() and extendOperatorSet() factories.
 *
 * Column operators are the source of truth. JSONB operators are auto-derived
 * via resolveContextualOperators() except where explicit overrides are needed.
 */

import {
	eq,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	notIlike,
	notInArray,
	notLike,
	sql,
} from "drizzle-orm";

import type { DateInput } from "#questpie/shared/type-utils.js";

import { operator } from "../types.js";
import type { CollectionWherePlaceholder } from "../types.js";
import { extendOperatorSet, operatorSet } from "./operator-set.js";

// ============================================================================
// String Operators
// ============================================================================

/**
 * Operators for text/string fields.
 * Used by: text, textarea.
 */
export const stringOps = operatorSet({
	jsonbCast: "text",
	column: {
		eq: operator<string, unknown>((col, value) => eq(col, value)),
		ne: operator<string, unknown>((col, value) => ne(col, value)),
		in: operator<string[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<string[], unknown>((col, values) =>
			notInArray(col, values),
		),
		like: operator<string, unknown>((col, value) => like(col, value)),
		ilike: operator<string, unknown>((col, value) => ilike(col, value)),
		notLike: operator<string, unknown>((col, value) => notLike(col, value)),
		notIlike: operator<string, unknown>((col, value) => notIlike(col, value)),
		contains: operator<string, unknown>(
			(col, value) => sql`${col} LIKE '%' || ${value} || '%'`,
		),
		startsWith: operator<string, unknown>(
			(col, value) => sql`${col} LIKE ${value} || '%'`,
		),
		endsWith: operator<string, unknown>(
			(col, value) => sql`${col} LIKE '%' || ${value}`,
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? isNull(col) : isNotNull(col),
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? isNotNull(col) : isNull(col),
		),
	},
});

// ============================================================================
// Number Operators
// ============================================================================

/**
 * Operators for numeric fields.
 */
export const numberOps = operatorSet({
	jsonbCast: "numeric",
	column: {
		eq: operator<number, unknown>((col, value) => eq(col, value)),
		ne: operator<number, unknown>((col, value) => ne(col, value)),
		gt: operator<number, unknown>((col, value) => gt(col, value)),
		gte: operator<number, unknown>((col, value) => gte(col, value)),
		lt: operator<number, unknown>((col, value) => lt(col, value)),
		lte: operator<number, unknown>((col, value) => lte(col, value)),
		in: operator<number[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<number[], unknown>((col, values) =>
			notInArray(col, values),
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? isNull(col) : isNotNull(col),
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? isNotNull(col) : isNull(col),
		),
	},
});

// ============================================================================
// Boolean Operators
// ============================================================================

/**
 * Operators for boolean fields.
 */
export const booleanOps = operatorSet({
	jsonbCast: "boolean",
	column: {
		eq: operator<boolean, unknown>((col, value) => eq(col, value)),
		ne: operator<boolean, unknown>((col, value) => ne(col, value)),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? isNull(col) : isNotNull(col),
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? isNotNull(col) : isNull(col),
		),
	},
});

// ============================================================================
// Date/Time Operators
// ============================================================================

/**
 * Operators for date/datetime/time fields.
 * Uses branded DateInput type to hide Date properties from autocomplete.
 */
export const dateOps = operatorSet({
	jsonbCast: "timestamp",
	column: {
		eq: operator<DateInput, unknown>((col, value) => eq(col, value)),
		ne: operator<DateInput, unknown>((col, value) => ne(col, value)),
		gt: operator<DateInput, unknown>((col, value) => gt(col, value)),
		gte: operator<DateInput, unknown>((col, value) => gte(col, value)),
		lt: operator<DateInput, unknown>((col, value) => lt(col, value)),
		lte: operator<DateInput, unknown>((col, value) => lte(col, value)),
		in: operator<DateInput[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<DateInput[], unknown>((col, values) =>
			notInArray(col, values),
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? isNull(col) : isNotNull(col),
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? isNotNull(col) : isNull(col),
		),
	},
});

// ============================================================================
// Email Operators
// ============================================================================

/**
 * Operators for email fields.
 * Extends string ops with domain matching.
 */
export const emailOps = extendOperatorSet(stringOps, {
	column: {
		domain: operator<string, unknown>((col, value) => ilike(col, `%@${value}`)),
		domainIn: operator<string[], unknown>((col, values) => {
			if (values.length === 0) return sql`FALSE`;
			if (values.length === 1) return ilike(col, `%@${values[0]}`);
			return sql`(${sql.join(
				values.map((d) => ilike(col, `%@${d}`)),
				sql` OR `,
			)})`;
		}),
	},
	jsonbOverrides: {
		domain: operator<string, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + value}`;
		}),
		domainIn: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			if (values.length === 0) return sql`FALSE`;
			if (values.length === 1)
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + values[0]}`;
			return sql`(${sql.join(
				values.map(
					(d) => sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%" + "@" + d}`,
				),
				sql` OR `,
			)})`;
		}),
	},
});

// ============================================================================
// URL Operators
// ============================================================================

/**
 * Operators for URL fields.
 * Extends string ops with host and protocol matching.
 */
export const urlOps = extendOperatorSet(stringOps, {
	column: {
		host: operator<string, unknown>((col, value) =>
			ilike(col, `%://${value}%`),
		),
		hostIn: operator<string[], unknown>((col, values) => {
			if (values.length === 0) return sql`FALSE`;
			if (values.length === 1) return ilike(col, `%://${values[0]}%`);
			return sql`(${sql.join(
				values.map((h) => ilike(col, `%://${h}%`)),
				sql` OR `,
			)})`;
		}),
		protocol: operator<string, unknown>((col, value) =>
			like(col, `${value}://%`),
		),
	},
	jsonbOverrides: {
		host: operator<string, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + value + "%"}`;
		}),
		hostIn: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			if (values.length === 0) return sql`FALSE`;
			if (values.length === 1)
				return sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + values[0] + "%"}`;
			return sql`(${sql.join(
				values.map(
					(h) => sql`${col}#>>'{${sql.raw(path)}}' ILIKE ${"%://" + h + "%"}`,
				),
				sql` OR `,
			)})`;
		}),
		protocol: operator<string, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>>'{${sql.raw(path)}}' LIKE ${value + "://%"}`;
		}),
	},
});

// ============================================================================
// Select Operators
// ============================================================================

/**
 * Operators for single select fields.
 */
export const selectSingleOps = operatorSet({
	jsonbCast: "text",
	column: {
		eq: operator<string, unknown>((col, value) => eq(col, value)),
		ne: operator<string, unknown>((col, value) => ne(col, value)),
		in: operator<string[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<string[], unknown>((col, values) =>
			notInArray(col, values),
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
		),
	},
});

/**
 * Operators for multi-select fields.
 * All JSONB ops are structural and need explicit overrides.
 */
export const selectMultiOps = operatorSet({
	jsonbCast: "jsonb",
	column: {
		containsAll: operator<string[], unknown>(
			(col, values) => sql`${col} @> ${JSON.stringify(values)}::jsonb`,
		),
		containsAny: operator<string[], unknown>(
			(col, values) =>
				sql`${col} ?| ARRAY[${sql.join(
					values.map((v) => sql`${v}`),
					sql`, `,
				)}]::text[]`,
		),
		eq: operator<string[], unknown>(
			(col, values) => sql`${col} = ${JSON.stringify(values)}::jsonb`,
		),
		isEmpty: operator<boolean, unknown>(
			(col) => sql`${col} = '[]'::jsonb OR ${col} IS NULL`,
		),
		isNotEmpty: operator<boolean, unknown>(
			(col) => sql`${col} != '[]'::jsonb AND ${col} IS NOT NULL`,
		),
		length: operator<number, unknown>(
			(col, value) => sql`jsonb_array_length(${col}) = ${value}`,
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
		),
	},
	jsonbOverrides: {
		containsAll: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
		}),
		containsAny: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' ?| ARRAY[${sql.join(
				values.map((v) => sql`${v}`),
				sql`, `,
			)}]::text[]`;
		}),
		eq: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' = ${JSON.stringify(values)}::jsonb`;
		}),
		isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
		}),
		isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
		}),
		length: operator<number, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`jsonb_array_length(${col}#>'{${sql.raw(path)}}') = ${value}`;
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
});

// ============================================================================
// Object Operators
// ============================================================================

/**
 * Operators for object/json fields.
 * Uses structural JSONB operations — all need explicit overrides.
 */
export const objectOps = operatorSet({
	jsonbCast: "jsonb",
	column: {
		contains: operator<unknown, unknown>(
			(col, value) => sql`${col} @> ${JSON.stringify(value)}::jsonb`,
		),
		containedBy: operator<unknown, unknown>(
			(col, value) => sql`${col} <@ ${JSON.stringify(value)}::jsonb`,
		),
		hasKey: operator<string, unknown>((col, value) => sql`${col} ? ${value}`),
		hasKeys: operator<string[], unknown>(
			(col, values) =>
				sql`${col} ?& ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`,
		),
		hasAnyKeys: operator<string[], unknown>(
			(col, values) =>
				sql`${col} ?| ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`,
		),
		pathEquals: operator<{ path: string[]; val: unknown }, unknown>(
			(col, value) => {
				return sql`${col}#>>'{${sql.raw(value.path.join(","))}}' = ${value.val}`;
			},
		),
		jsonPath: operator<string, unknown>(
			(col, value) => sql`${col} @@ ${value}::jsonpath`,
		),
		isEmpty: operator<boolean, unknown>(
			(col) => sql`(${col} = '{}'::jsonb OR ${col} IS NULL)`,
		),
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
	jsonbOverrides: {
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
		hasAnyKeys: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' ?| ${sql.raw(`ARRAY[${values.map((v) => `'${v}'`).join(",")}]`)}`;
		}),
		pathEquals: operator<{ path: string[]; val: unknown }, unknown>(
			(col, value, ctx) => {
				const basePath = ctx.jsonbPath?.join(",") ?? "";
				const fullPath = basePath
					? `${basePath},${value.path.join(",")}`
					: value.path.join(",");
				return sql`${col}#>>'{${sql.raw(fullPath)}}' = ${value.val}`;
			},
		),
		jsonPath: operator<string, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' @@ ${value}::jsonpath`;
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
});

// ============================================================================
// Relation Operators
// ============================================================================

/**
 * Operators for belongsTo relations (FK field).
 * Includes standard string ops + is/isNot quantifiers.
 */
export const belongsToOps = operatorSet({
	jsonbCast: "text",
	column: {
		eq: operator<string, unknown>((col, value) => eq(col, value)),
		ne: operator<string, unknown>((col, value) => ne(col, value)),
		in: operator<string[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<string[], unknown>((col, values) =>
			notInArray(col, values),
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
		),
		is: operator<CollectionWherePlaceholder, unknown>(() => sql`TRUE`),
		isNot: operator<CollectionWherePlaceholder, unknown>(() => sql`TRUE`),
	},
});

/**
 * Operators for hasMany/manyToMany/morphMany.
 * These are placeholder operators — actual implementation is in the query builder
 * (relation subqueries). No JSONB variant (these fields have no column).
 */
export const toManyOps = operatorSet({
	jsonbCast: null,
	column: {
		some: operator<CollectionWherePlaceholder, unknown>(() => sql`TRUE`),
		none: operator<CollectionWherePlaceholder, unknown>(() => sql`TRUE`),
		every: operator<CollectionWherePlaceholder, unknown>(() => sql`TRUE`),
		count: operator<number, unknown>(() => sql`0`),
	},
});

/**
 * Operators for multiple relation (jsonb array of FKs).
 * All structural JSONB ops need explicit overrides.
 */
export const multipleOps = operatorSet({
	jsonbCast: "jsonb",
	column: {
		contains: operator<string, unknown>(
			(col, value) => sql`${col} @> ${JSON.stringify([value])}::jsonb`,
		),
		containsAll: operator<string[], unknown>(
			(col, values) => sql`${col} @> ${JSON.stringify(values)}::jsonb`,
		),
		containsAny: operator<string[], unknown>(
			(col, values) =>
				sql`${col} ?| ARRAY[${sql.join(
					values.map((v) => sql`${v}`),
					sql`, `,
				)}]::text[]`,
		),
		isEmpty: operator<boolean, unknown>(
			(col) => sql`(${col} = '[]'::jsonb OR ${col} IS NULL)`,
		),
		isNotEmpty: operator<boolean, unknown>(
			(col) => sql`(${col} != '[]'::jsonb AND ${col} IS NOT NULL)`,
		),
		count: operator<number, unknown>(
			(col, value) =>
				sql`jsonb_array_length(COALESCE(${col}, '[]'::jsonb)) = ${value}`,
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NULL` : sql`${col} IS NOT NULL`,
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? sql`${col} IS NOT NULL` : sql`${col} IS NULL`,
		),
	},
	jsonbOverrides: {
		contains: operator<string, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify([value])}::jsonb`;
		}),
		containsAll: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' @> ${JSON.stringify(values)}::jsonb`;
		}),
		containsAny: operator<string[], unknown>((col, values, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`${col}#>'{${sql.raw(path)}}' ?| ARRAY[${sql.join(
				values.map((v) => sql`${v}`),
				sql`, `,
			)}]::text[]`;
		}),
		isEmpty: operator<boolean, unknown>((col, _value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`(${col}#>'{${sql.raw(path)}}' = '[]'::jsonb OR ${col}#>'{${sql.raw(path)}}' IS NULL)`;
		}),
		isNotEmpty: operator<boolean, unknown>((col, _value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`(${col}#>'{${sql.raw(path)}}' != '[]'::jsonb AND ${col}#>'{${sql.raw(path)}}' IS NOT NULL)`;
		}),
		count: operator<number, unknown>((col, value, ctx) => {
			const path = ctx.jsonbPath?.join(",") ?? "";
			return sql`jsonb_array_length(COALESCE(${col}#>'{${sql.raw(path)}}', '[]'::jsonb)) = ${value}`;
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
});

// ============================================================================
// Basic Operators (for json field)
// ============================================================================

/**
 * Basic operators for the raw json field type.
 */
export const basicOps = operatorSet({
	jsonbCast: "jsonb",
	column: {
		eq: operator<unknown, unknown>((col, value) => eq(col, value)),
		ne: operator<unknown, unknown>((col, value) => ne(col, value)),
		in: operator<unknown[], unknown>((col, values) => inArray(col, values)),
		notIn: operator<unknown[], unknown>((col, values) =>
			notInArray(col, values),
		),
		isNull: operator<boolean, unknown>((col, value) =>
			value ? isNull(col) : isNotNull(col),
		),
		isNotNull: operator<boolean, unknown>((col, value) =>
			value ? isNotNull(col) : isNull(col),
		),
	},
});
