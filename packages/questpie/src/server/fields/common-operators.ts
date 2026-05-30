/**
 * Common operator sets for reuse across field types.
 *
 * Each operator is properly typed with explicit value types.
 * These can be composed and extended by field implementations.
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

import { jsonbPathRef } from "./operators/jsonb-sql.js";
import { operator } from "./types.js";

// ============================================================================
// Text/String Operators
// ============================================================================

/**
 * Column operators for text/string fields.
 * Handles: text, textarea, email, url.
 */
export const stringColumnOperators = {
	eq: operator<string, unknown>((col, value) => eq(col, value)),
	ne: operator<string, unknown>((col, value) => ne(col, value)),
	in: operator<string[], unknown>((col, values) => inArray(col, values)),
	notIn: operator<string[], unknown>((col, values) => notInArray(col, values)),
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
} as const;

/**
 * JSONB operators for text/string fields.
 */
export const stringJsonbOperators = {
	eq: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} = ${value}`;
	}),
	ne: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} != ${value}`;
	}),
	in: operator<string[], unknown>((col, values, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} = ANY(${values}::text[])`;
	}),
	notIn: operator<string[], unknown>((col, values, ctx) => {
		return sql`NOT (${jsonbPathRef(col, ctx.jsonbPath, false)} = ANY(${values}::text[]))`;
	}),
	like: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} LIKE ${value}`;
	}),
	ilike: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} ILIKE ${value}`;
	}),
	contains: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} LIKE '%' || ${value} || '%'`;
	}),
	startsWith: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} LIKE ${value} || '%'`;
	}),
	endsWith: operator<string, unknown>((col, value, ctx) => {
		return sql`${jsonbPathRef(col, ctx.jsonbPath, false)} LIKE '%' || ${value}`;
	}),
	isNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`
			: sql`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`;
	}),
	isNotNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`
			: sql`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`;
	}),
} as const;

// ============================================================================
// Number Operators
// ============================================================================

/**
 * Column operators for numeric fields.
 */
export const numberColumnOperators = {
	eq: operator<number, unknown>((col, value) => eq(col, value)),
	ne: operator<number, unknown>((col, value) => ne(col, value)),
	gt: operator<number, unknown>((col, value) => gt(col, value)),
	gte: operator<number, unknown>((col, value) => gte(col, value)),
	lt: operator<number, unknown>((col, value) => lt(col, value)),
	lte: operator<number, unknown>((col, value) => lte(col, value)),
	in: operator<number[], unknown>((col, values) => inArray(col, values)),
	notIn: operator<number[], unknown>((col, values) => notInArray(col, values)),
	isNull: operator<boolean, unknown>((col, value) =>
		value ? isNull(col) : isNotNull(col),
	),
	isNotNull: operator<boolean, unknown>((col, value) =>
		value ? isNotNull(col) : isNull(col),
	),
} as const;

/**
 * JSONB operators for numeric fields.
 */
export const numberJsonbOperators = {
	eq: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric = ${value}`;
	}),
	ne: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric != ${value}`;
	}),
	gt: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric > ${value}`;
	}),
	gte: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric >= ${value}`;
	}),
	lt: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric < ${value}`;
	}),
	lte: operator<number, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric <= ${value}`;
	}),
	in: operator<number[], unknown>((col, values, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric = ANY(${values}::numeric[])`;
	}),
	notIn: operator<number[], unknown>((col, values, ctx) => {
		return sql<boolean>`NOT ((${jsonbPathRef(col, ctx.jsonbPath, false)})::numeric = ANY(${values}::numeric[]))`;
	}),
	isNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`;
	}),
	isNotNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`;
	}),
} as const;

// ============================================================================
// Date/Time Operators
// ============================================================================

/**
 * Column operators for date/datetime/time fields.
 * Accepts both Date objects and ISO strings.
 * Uses branded DateInput type to hide Date properties from autocomplete.
 */
export const dateColumnOperators = {
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
} as const;

/**
 * JSONB operators for date/datetime/time fields.
 * Uses branded DateInput type to hide Date properties from autocomplete.
 */
export const dateJsonbOperators = {
	eq: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp = ${value}`;
	}),
	ne: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp != ${value}`;
	}),
	gt: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp > ${value}`;
	}),
	gte: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp >= ${value}`;
	}),
	lt: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp < ${value}`;
	}),
	lte: operator<DateInput, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp <= ${value}`;
	}),
	in: operator<DateInput[], unknown>((col, values, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp = ANY(${values}::timestamp[])`;
	}),
	notIn: operator<DateInput[], unknown>((col, values, ctx) => {
		return sql<boolean>`NOT ((${jsonbPathRef(col, ctx.jsonbPath, false)})::timestamp = ANY(${values}::timestamp[]))`;
	}),
	isNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`;
	}),
	isNotNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`;
	}),
} as const;

// ============================================================================
// Boolean Operators
// ============================================================================

/**
 * Column operators for boolean fields.
 */
export const booleanColumnOperators = {
	eq: operator<boolean, unknown>((col, value) => eq(col, value)),
	ne: operator<boolean, unknown>((col, value) => ne(col, value)),
	isNull: operator<boolean, unknown>((col, value) =>
		value ? isNull(col) : isNotNull(col),
	),
	isNotNull: operator<boolean, unknown>((col, value) =>
		value ? isNotNull(col) : isNull(col),
	),
} as const;

/**
 * JSONB operators for boolean fields.
 */
export const booleanJsonbOperators = {
	eq: operator<boolean, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::boolean = ${value}`;
	}),
	ne: operator<boolean, unknown>((col, value, ctx) => {
		return sql<boolean>`(${jsonbPathRef(col, ctx.jsonbPath, false)})::boolean != ${value}`;
	}),
	isNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`;
	}),
	isNotNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`;
	}),
} as const;

// ============================================================================
// Basic Operators (for json/object/array/select)
// ============================================================================

/**
 * Basic column operators for fields without rich comparison.
 * Used by: json, object, array, select.
 */
export const basicColumnOperators = {
	eq: operator<unknown, unknown>((col, value) => eq(col, value)),
	ne: operator<unknown, unknown>((col, value) => ne(col, value)),
	in: operator<unknown[], unknown>((col, values) => inArray(col, values)),
	notIn: operator<unknown[], unknown>((col, values) => notInArray(col, values)),
	isNull: operator<boolean, unknown>((col, value) =>
		value ? isNull(col) : isNotNull(col),
	),
	isNotNull: operator<boolean, unknown>((col, value) =>
		value ? isNotNull(col) : isNull(col),
	),
} as const;

/**
 * Basic JSONB operators.
 */
export const basicJsonbOperators = {
	eq: operator<unknown, unknown>((col, value, ctx) => {
		return sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} = ${value}::jsonb`;
	}),
	ne: operator<unknown, unknown>((col, value, ctx) => {
		return sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} != ${value}::jsonb`;
	}),
	isNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`;
	}),
	isNotNull: operator<boolean, unknown>((col, value, ctx) => {
		return value
			? sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NOT NULL`
			: sql<boolean>`${jsonbPathRef(col, ctx.jsonbPath, true)} IS NULL`;
	}),
} as const;
