/**
 * WHERE Clause Building Utilities
 *
 * Pure functions for building SQL WHERE clauses from query objects.
 * Supports field operators, logical operators (AND/OR/NOT), and relation filtering.
 */

import {
	and,
	type Column,
	eq,
	getTableName,
	gt,
	gte,
	inArray,
	lt,
	lte,
	ne,
	not,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { mapColumnsInSQLToAlias } from "drizzle-orm/alias";
import { alias, type AnyPgColumn, type PgTable } from "drizzle-orm/pg-core";

import type {
	AccessWhere,
	CollectionBuilderState,
	RelationConfig,
} from "#questpie/server/collection/builder/types.js";
import {
	isAccessWhere,
	RELATION_READ_ACCESS,
	type RelationReadAccess,
} from "#questpie/server/collection/crud/shared/access-control.js";
import {
	getColumn,
	getDb,
} from "#questpie/server/collection/crud/shared/index.js";
import { readAccessOf } from "#questpie/server/collection/crud/shared/relation-read.js";
import type {
	CRUDContext,
	Where,
} from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { ApiError } from "#questpie/server/errors/base.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import type { OperatorFn } from "#questpie/server/fields/types.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import {
	parseCalendarDate,
	parseRfc3339Instant,
} from "#questpie/shared/temporal.js";

/**
 * Options for building WHERE clause
 */
export interface BuildWhereClauseOptions {
	/** The table to query against */
	table: PgTable;
	/** Collection builder state */
	state: CollectionBuilderState;
	/** Aliased i18n table for current locale (null if no i18n) */
	i18nCurrentTable: PgTable | null;
	/** Aliased i18n table for fallback locale (null if no fallback needed) */
	i18nFallbackTable: PgTable | null;
	/** CRUD context */
	context?: CRUDContext;
	/** app instance for relation resolution */
	app?: Questpie<any>;
	/** Whether to use i18n tables for localized fields */
	useI18n?: boolean;
	/** Database instance for subqueries */
	db?: any;
	/** Internal: this subtree came from an access rule and must never weaken. */
	failClosedAccess?: boolean;
	/** Internal: exact parent values for correlation without an outer table alias. */
	parentRecord?: Readonly<Record<string, unknown>>;
	/** Internal: unique relation aliases for a single-record access evaluation. */
	relationAliasDepth?: number;
}

/**
 * Build a SQL reference to a localized field with COALESCE fallback.
 *
 * For WHERE and ORDER BY clauses, we need COALESCE to handle fallback:
 * COALESCE(i18n_current.field, i18n_fallback.field)
 *
 * @param field - Field name
 * @param options - Options containing table references and state
 * @returns SQL expression for the field (with COALESCE if localized, direct reference otherwise)
 */
export function buildLocalizedFieldRef(
	field: string,
	options: {
		table: PgTable;
		state: CollectionBuilderState;
		i18nCurrentTable: PgTable | null;
		i18nFallbackTable: PgTable | null;
		useI18n?: boolean;
	},
): SQL | AnyPgColumn | ReturnType<typeof sql.identifier> | undefined {
	const { table, state, i18nCurrentTable, i18nFallbackTable, useI18n } =
		options;

	const virtualExpression = state.virtuals?.[field];
	if (virtualExpression) {
		return virtualExpression;
	}

	const fieldDef = state.fieldDefinitions?.[field];
	if (fieldDef?.getLocation() === "virtual") {
		return undefined;
	}

	// Check if field is localized and i18n is enabled
	if (!useI18n || !i18nCurrentTable || !state.localized.includes(field)) {
		// Not localized - return direct table reference
		const column = getColumn(table, field);
		if (column) return column;
		return sql.identifier(field);
	}

	const currentCol = getColumn(i18nCurrentTable, field);

	// If no fallback table, return current locale reference only
	if (!i18nFallbackTable) {
		return currentCol ?? sql.identifier(field);
	}

	const fallbackCol = getColumn(i18nFallbackTable, field);

	// Return COALESCE(current, fallback)
	if (currentCol && fallbackCol) {
		return sql`COALESCE(${currentCol}, ${fallbackCol})`;
	}
	return currentCol ?? fallbackCol ?? sql.identifier(field);
}

function isNonQueryableVirtualField(
	field: string,
	state: CollectionBuilderState,
): boolean {
	const fieldDef = state.fieldDefinitions?.[field];
	if (!fieldDef || fieldDef.getLocation() !== "virtual") {
		return false;
	}

	return !(state.virtuals && field in state.virtuals);
}

const TEMPORAL_VALUE_OPERATORS = new Set([
	"eq",
	"ne",
	"not",
	"gt",
	"gte",
	"lt",
	"lte",
]);

function normalizeTemporalWhereValue(
	field: Field<FieldState> | undefined,
	operator: string,
	value: unknown,
): unknown {
	const state = field?._state;
	if (!state || state.isArray === true) return value;
	if (
		!TEMPORAL_VALUE_OPERATORS.has(operator) &&
		operator !== "in" &&
		operator !== "notIn"
	) {
		return value;
	}
	if (operator === "not" && value === null) return null;

	const normalizeOne = (candidate: unknown): unknown => {
		if (state.type === "datetime") {
			const instant = parseRfc3339Instant(candidate);
			if (instant) return instant;
			throw ApiError.badRequest(
				"Datetime filters require a Date or RFC 3339 value with Z or an explicit offset",
			);
		}
		if (state.type === "date") {
			const date = parseCalendarDate(candidate);
			if (date) return date;
			throw ApiError.badRequest(
				"Date filters require an exact YYYY-MM-DD calendar date",
			);
		}
		return candidate;
	};

	if (operator === "in" || operator === "notIn") {
		if (!Array.isArray(value)) return normalizeOne(value);
		return value.map(normalizeOne);
	}
	return normalizeOne(value);
}

// Keys that classify a filter value as field operators or relation
// quantifiers. Shared by the compiler and `authorizeRelationPredicates`.
const STANDARD_FIELD_OPERATORS = [
	"eq",
	"ne",
	"not",
	"gt",
	"gte",
	"lt",
	"lte",
	"in",
	"notIn",
	"like",
	"ilike",
	"notLike",
	"notIlike",
	"contains",
	"startsWith",
	"endsWith",
	"isNull",
	"isNotNull",
	"arrayOverlaps",
	"arrayContained",
	"arrayContains",
	// JSONB structural ops (select multi, object, array)
	"containsAll",
	"containsAny",
	"containedBy",
	"hasKey",
	"hasKeys",
	"hasAnyKeys",
	"pathEquals",
	"jsonPath",
	"isEmpty",
	"isNotEmpty",
	"length",
	"count",
];
const RELATION_QUANTIFIERS = ["some", "none", "every", "is", "isNot"];

/**
 * Build WHERE clause from WHERE object
 *
 * @param where - The WHERE object to convert to SQL
 * @param options - Options for building the clause
 * @returns SQL condition or undefined if no conditions
 */
export function buildWhereClause(
	where: Where,
	options: BuildWhereClauseOptions,
): SQL | undefined {
	const {
		table,
		state,
		i18nCurrentTable,
		i18nFallbackTable,
		context,
		app,
		useI18n = false,
	} = options;
	const failClosedAccess =
		options.failClosedAccess === true || isAccessWhere(where);

	const conditions: SQL[] = [];

	for (const [key, value] of Object.entries(where)) {
		if (key === "AND" && Array.isArray(value)) {
			const subClauses = value
				.map((w) =>
					buildWhereClause(w, {
						table,
						state,
						i18nCurrentTable,
						i18nFallbackTable,
						context,
						app,
						useI18n,
						db: options.db,
						failClosedAccess,
						parentRecord: options.parentRecord,
						relationAliasDepth: options.relationAliasDepth,
					}),
				)
				.filter(Boolean) as SQL[];
			if (subClauses.length > 0) {
				conditions.push(and(...subClauses)!);
			}
		} else if (key === "OR" && Array.isArray(value)) {
			const subClauses = value
				.map((w) =>
					buildWhereClause(w, {
						table,
						state,
						i18nCurrentTable,
						i18nFallbackTable,
						context,
						app,
						useI18n,
						db: options.db,
						failClosedAccess,
						parentRecord: options.parentRecord,
						relationAliasDepth: options.relationAliasDepth,
					}),
				)
				.filter(Boolean) as SQL[];
			if (subClauses.length > 0) {
				conditions.push(or(...subClauses)!);
			} else if (failClosedAccess) {
				conditions.push(sql`false`);
			}
		} else if (key === "NOT" && typeof value === "object") {
			const subClause = buildWhereClause(value as Where, {
				table,
				state,
				i18nCurrentTable,
				i18nFallbackTable,
				context,
				app,
				useI18n,
				db: options.db,
				failClosedAccess,
				parentRecord: options.parentRecord,
				relationAliasDepth: options.relationAliasDepth,
			});
			if (subClause) {
				conditions.push(not(subClause));
			} else if (failClosedAccess) {
				conditions.push(sql`false`);
			}
		} else if (key === "RAW" && typeof value === "function") {
			conditions.push(
				value({
					table,
					i18nCurrentTable,
					i18nFallbackTable,
				}),
			);
		} else if (
			typeof value === "object" &&
			value !== null &&
			!Array.isArray(value)
		) {
			// Look up the field definition for field-driven operator dispatch
			const fieldDef = state.fieldDefinitions?.[key] as
				| Field<FieldState>
				| undefined;
			const fieldOps = fieldDef?.getOperators?.();
			const fieldColumnOps = fieldOps?.column;

			// Determine if value contains field operators or relation quantifiers
			// Use the field's actual operator keys (if available) in addition to the
			// standard hardcoded list, so custom operators (e.g., email.domain) are
			// correctly recognized as field operators.
			const valueKeys = Object.keys(value as Record<string, any>);
			if (
				valueKeys.length === 0 &&
				failClosedAccess &&
				!state.relations?.[key]
			) {
				conditions.push(sql`false`);
				continue;
			}

			// A key is a field operator if it's in the standard list OR in the field's operator map
			const hasFieldOperators = valueKeys.some(
				(k) =>
					STANDARD_FIELD_OPERATORS.includes(k) ||
					(fieldColumnOps && k in fieldColumnOps),
			);
			const hasRelationQuantifiers = valueKeys.some((k) =>
				RELATION_QUANTIFIERS.includes(k),
			);

			// If value contains field operators, treat as field filter
			// If value contains relation quantifiers OR key is a relation and value has no operators, treat as relation filter
			if (hasFieldOperators && !hasRelationQuantifiers) {
				// Field operators - use buildLocalizedFieldRef for proper COALESCE handling
				const column = buildLocalizedFieldRef(key, {
					table,
					state,
					i18nCurrentTable,
					i18nFallbackTable,
					useI18n,
				});

				if (!column) {
					if (isNonQueryableVirtualField(key, state)) {
						throw new Error(
							`Field '${key}' uses 'virtual: true' and is not queryable. Use 'virtual: sql\`...\`' to filter by this field.`,
						);
					}
					continue;
				}

				for (const [op, val] of Object.entries(value as Record<string, any>)) {
					const condition = resolveFieldOperatorCondition(
						column,
						op,
						normalizeTemporalWhereValue(fieldDef, op, val),
						fieldColumnOps,
					);
					if (condition) conditions.push(condition);
					else if (failClosedAccess) {
						throw accessCompilationError(state.name, key, op);
					}
				}
			} else if (state.relations?.[key]) {
				// Relation filter (has quantifiers or is a plain object for nested matching)
				const relation = state.relations[key] as RelationConfig;
				const relationClause = buildRelationWhereClause(relation, value, {
					parentTable: table,
					parentState: state,
					context,
					app,
					db: options.db,
					failClosedAccess,
					parentRecord: options.parentRecord,
					relationAliasDepth: options.relationAliasDepth,
				});
				if (relationClause) {
					conditions.push(relationClause);
				} else if (failClosedAccess) {
					throw accessCompilationError(state.name, key);
				}
			} else {
				// Fallback: treat as field operators
				const column = buildLocalizedFieldRef(key, {
					table,
					state,
					i18nCurrentTable,
					i18nFallbackTable,
					useI18n,
				});

				if (!column) {
					if (isNonQueryableVirtualField(key, state)) {
						throw new Error(
							`Field '${key}' uses 'virtual: true' and is not queryable. Use 'virtual: sql\`...\`' to filter by this field.`,
						);
					}
					continue;
				}

				for (const [op, val] of Object.entries(value as Record<string, any>)) {
					const condition = resolveFieldOperatorCondition(
						column,
						op,
						normalizeTemporalWhereValue(fieldDef, op, val),
						fieldColumnOps,
					);
					if (condition) conditions.push(condition);
					else if (failClosedAccess) {
						throw accessCompilationError(state.name, key, op);
					}
				}
			}
		} else {
			// Simple equality - use buildLocalizedFieldRef for proper COALESCE handling
			const column = buildLocalizedFieldRef(key, {
				table,
				state,
				i18nCurrentTable,
				i18nFallbackTable,
				useI18n,
			});

			if (!column) {
				if (isNonQueryableVirtualField(key, state)) {
					throw ApiError.badRequest(
						`Field '${key}' uses 'virtual: true' and is not queryable. Use 'virtual: sql\`...\`' to filter by this field.`,
					);
				}
				continue;
			}

			if (value === null) {
				conditions.push(sql`${column} IS NULL`);
			} else {
				// Column ref may be AnyPgColumn | SQL | Name — eq() needs Column overload
				const fieldDef = state.fieldDefinitions?.[key] as
					| Field<FieldState>
					| undefined;
				conditions.push(
					eq(
						column as Column,
						normalizeTemporalWhereValue(fieldDef, "eq", value),
					),
				);
			}
		}
	}

	return conditions.length > 0 ? and(...conditions) : undefined;
}

/**
 * Resolve a field operator condition.
 *
 * First checks the field's own operator map (if available) for field-driven
 * dispatch. This enables custom operators like email's `domain` and url's
 * `host` to work at runtime. Falls back to the standard hardcoded switch
 * for built-in operators.
 *
 * @param column - The column to apply the operator to
 * @param op - The operator name
 * @param value - The value for the operator
 * @param fieldOps - The field's column operator map (from getOperators().column)
 * @returns SQL condition or undefined if operator not recognized
 */
export function resolveFieldOperatorCondition(
	column: any,
	op: string,
	value: any,
	fieldOps?: Record<string, OperatorFn<any, any> | undefined>,
): SQL | undefined {
	// Try field-driven dispatch first
	if (fieldOps) {
		const operatorFn = fieldOps[op];
		if (operatorFn) {
			return operatorFn(column, value, {});
		}
	}

	// Fall back to standard hardcoded operators
	return buildOperatorCondition(column, op, value);
}

/**
 * Build operator condition for a field
 *
 * Operators that compare a column against a value OF THAT COLUMN'S OWN TYPE
 * (`eq`, `ne`, `not`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`) go through
 * drizzle's helpers so the value is bound with the column's own
 * `mapToDriverValue`. That encoder is the single definition of how a value of
 * this column's type is represented on the wire — it is what INSERT and SELECT
 * already use — so a comparison that bypasses it compares a value encoded one
 * way against data that was written another way.
 *
 * Interpolating a value into a raw `sql` template instead binds it with the
 * NOOP encoder, handing the raw JS value to the driver and leaving the wire
 * format up to whichever driver happens to be installed. Measured consequences
 * of the noop path:
 *
 *  - `node-postgres` renders a `Date` in LOCAL time with an offset
 *    (`2026-08-05T08:00:00.000+02:00`). Postgres discards the offset for a
 *    `timestamp` WITHOUT time zone column — which is what `createdAt` /
 *    `updatedAt` / `deletedAt` are (`server/db/system-columns.ts`) — so the
 *    boundary of a range filter moves by the client's UTC offset. Under
 *    `TZ=America/Los_Angeles` a `gt` over `updatedAt` returns rows from BEFORE
 *    the boundary; the column encoder's `toISOString()` is UTC and matches how
 *    the value was written. Invisible on a UTC machine.
 *  - a `numeric` column (`f.number({ mode: "decimal" })`) receives a JS number,
 *    so Postgres compares in float8 and silently loses precision past 2^53;
 *    the encoder sends text and the comparison stays in `numeric`.
 *  - an array column receives a JS array, which drizzle splats into a SQL row
 *    constructor (`col > ($1, $2)`) rather than an array literal.
 *
 * Pattern operators (`like`, `ilike`, `contains`, `startsWith`, ...) compare
 * against a PATTERN rather than a value of the column's type, so they keep the
 * raw template — encoding `%foo%` as the column's type would be wrong.
 *
 * When `column` is a bare SQL expression (a localized `COALESCE`, a
 * `virtual(sql)`) there is no encoder to apply and drizzle's `bindIfParam`
 * leaves the value untouched, exactly as before.
 *
 * @param column - The column to apply the operator to
 * @param op - The operator name (eq, ne, gt, gte, lt, lte, in, etc.)
 * @param value - The value for the operator
 * @returns SQL condition or undefined if operator not recognized
 */
export function buildOperatorCondition(
	column: any,
	op: string,
	value: any,
): SQL | undefined {
	switch (op) {
		case "eq":
			return eq(column, value);
		case "ne":
			return ne(column, value);
		case "not":
			// Handle "not" operator: { field: { not: value } }
			if (value === null) {
				return sql`${column} IS NOT NULL`;
			}
			return ne(column, value);
		case "gt":
			return gt(column, value);
		case "gte":
			return gte(column, value);
		case "lt":
			return lt(column, value);
		case "lte":
			return lte(column, value);
		case "in":
			return Array.isArray(value) ? inArray(column, value) : undefined;
		case "notIn":
			return Array.isArray(value) ? not(inArray(column, value)) : undefined;
		case "like":
			return sql`${column} LIKE ${value}`;
		case "ilike":
			return sql`${column} ILIKE ${value}`;
		case "notLike":
			return sql`${column} NOT LIKE ${value}`;
		case "notIlike":
			return sql`${column} NOT ILIKE ${value}`;
		case "contains":
			return sql`${column} ILIKE ${`%${value}%`}`;
		case "startsWith":
			return sql`${column} ILIKE ${`${value}%`}`;
		case "endsWith":
			return sql`${column} ILIKE ${`%${value}`}`;
		case "isNull":
			return value ? sql`${column} IS NULL` : sql`${column} IS NOT NULL`;
		case "isNotNull":
			return value ? sql`${column} IS NOT NULL` : sql`${column} IS NULL`;
		case "arrayOverlaps":
			return sql`${column} && ${value}`;
		case "arrayContained":
			return sql`${column} <@ ${value}`;
		case "arrayContains":
			return sql`${column} @> ${value}`;
		default:
			return undefined;
	}
}

/**
 * Whether `where[key]` filters through a relation, exactly as
 * `buildWhereClause` classifies it.
 */
function isRelationFilter(
	key: string,
	value: unknown,
	state: CollectionBuilderState,
): value is Record<string, unknown> {
	if (
		!state.relations?.[key] ||
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value)
	) {
		return false;
	}
	const fieldColumnOps = (
		state.fieldDefinitions?.[key] as Field<FieldState> | undefined
	)?.getOperators?.()?.column;
	const valueKeys = Object.keys(value);
	const hasFieldOperators = valueKeys.some(
		(k) =>
			STANDARD_FIELD_OPERATORS.includes(k) ||
			(fieldColumnOps && k in fieldColumnOps),
	);
	return (
		!hasFieldOperators ||
		valueKeys.some((k) => RELATION_QUANTIFIERS.includes(k))
	);
}

type RelationSlot = "is" | "isNot" | "some" | "none" | "every";
type RelationRead = { slot: RelationSlot; where: unknown; key?: string };
type RelationReadDecisions = Partial<Record<RelationSlot, RelationReadAccess>>;

/**
 * The reads a relation filter compiles to: one EXISTS over the related rows
 * per slot, negated for `isNot`, `none` and `every`. `key` is the filter key
 * the slot's where came from; a plain nested filter has none.
 */
function relationReads(
	relation: RelationConfig,
	filter: Record<string, any>,
): RelationRead[] {
	const plain = !RELATION_QUANTIFIERS.some((key) => key in filter);
	const first = (slot: RelationSlot, keys: string[]): RelationRead[] => {
		const key = keys.find((candidate) => filter[candidate] != null);
		if (key) return [{ slot, where: filter[key], key }];
		return plain ? [{ slot, where: filter }] : [];
	};
	const direct = (slot: RelationSlot): RelationRead[] =>
		filter[slot] === undefined
			? []
			: [{ slot, where: filter[slot], key: slot }];
	if (relation.type === "one") {
		return [...first("is", ["is", "some"]), ...direct("isNot")];
	}
	if (relation.type === "many" || relation.type === "manyToMany") {
		return [...first("some", ["some"]), ...direct("none"), ...direct("every")];
	}
	return [];
}

/** The related rows a slot's EXISTS reads: `every` tests the rows failing it. */
function slotWhere(slot: RelationSlot, where: unknown): Where {
	return (slot === "every" ? { NOT: where } : where) as Where;
}

/**
 * Resolve the caller's read access to the target (and junction) rows of every
 * relation predicate in a CALLER-authored where, before it is compiled. The
 * compiler restricts each relation set to that access before `some`, `none`,
 * `every`, `is` or `isNot` quantify over it, so a target the caller may not
 * read is an empty set rather than an oracle over its rows.
 *
 * Each read is decided by the target's own rule with that read's concrete
 * options (`{ where }`), never shared across predicates: a rule may branch on
 * `input.where`.
 *
 * Access predicates (`ACCESS_WHERE`) are server-authored and stay untouched:
 * they may express cross-resource authority without consulting the targets'
 * rules. System mode is not gated.
 */
export async function authorizeRelationPredicates(
	where: Where | undefined,
	options: {
		state: CollectionBuilderState;
		app?: Questpie<any>;
		context: CRUDContext;
	},
): Promise<Where | undefined> {
	const { app, context } = options;
	if (!where || !app || context.accessMode === "system") return where;

	const authorizeRelation = async (
		relation: RelationConfig,
		filter: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		const targetCrud = app.collections[relation.collection];
		const throughCrud =
			relation.type === "manyToMany" && relation.through
				? app.collections[relation.through]
				: undefined;
		const targetState = targetCrud["~internalState"];
		let authorized: Record<string, unknown> = { ...filter };
		const decisions: RelationReadDecisions = {};
		for (const read of relationReads(relation, filter)) {
			const access: RelationReadAccess = {
				target: relation.inheritAccess
					? true
					: await readAccessOf(targetCrud)(context, {
							where: slotWhere(read.slot, read.where),
						}),
			};
			if (throughCrud) {
				access.through = relation.inheritAccess
					? true
					: await readAccessOf(throughCrud)(context, { where: {} });
			}
			decisions[read.slot] = access;
			if (access.target === false || access.through === false) continue;

			const nested = await authorize(read.where as Where, targetState);
			if (read.key) authorized[read.key] = nested;
			else authorized = nested as Record<string, unknown>;
		}
		return Object.defineProperty(authorized, RELATION_READ_ACCESS, {
			value: decisions,
		});
	};

	const authorize = async (
		node: Where,
		state: CollectionBuilderState,
	): Promise<Where> => {
		if (!node || typeof node !== "object" || isAccessWhere(node)) return node;
		const authorized: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(node)) {
			if ((key === "AND" || key === "OR") && Array.isArray(value)) {
				authorized[key] = await Promise.all(
					value.map((entry) => authorize(entry, state)),
				);
			} else if (key === "NOT" && typeof value === "object") {
				authorized[key] = await authorize(value as Where, state);
			} else if (isRelationFilter(key, value, state)) {
				authorized[key] = await authorizeRelation(
					state.relations![key]!,
					value,
				);
			} else {
				authorized[key] = value;
			}
		}
		return authorized as Where;
	};

	return authorize(where, options.state);
}

/**
 * Options for building relation WHERE clauses
 */
interface BuildRelationWhereOptions {
	/** Parent table being queried */
	parentTable: PgTable;
	/** Parent collection state */
	parentState: CollectionBuilderState;
	/** CRUD context */
	context?: CRUDContext;
	/** app instance for relation resolution */
	app?: Questpie<any>;
	/** Database instance */
	db?: any;
	/** Whether this relation predicate originated from access control. */
	failClosedAccess?: boolean;
	/** Exact parent values used instead of a shadowable outer correlation. */
	parentRecord?: Readonly<Record<string, unknown>>;
	/** Unique relation aliases for a single-record access evaluation. */
	relationAliasDepth?: number;
	/** The caller's read access to this relation's rows (caller predicates only). */
	readAccess?: RelationReadAccess;
}

function relationQueryTarget(
	baseTable: PgTable,
	state: CollectionBuilderState,
	options: BuildRelationWhereOptions,
): { table: PgTable; state: CollectionBuilderState } {
	const depth = options.relationAliasDepth ?? 0;
	if (getTableName(options.parentTable) !== getTableName(baseTable)) {
		return { table: baseTable, state };
	}

	const aliasName = `qp_access_relation_${depth}`;
	const table = alias(baseTable, aliasName);
	const virtuals = Object.fromEntries(
		Object.entries(state.virtuals ?? {}).flatMap(([field, expression]) => {
			if (hasUnsafeRelationVirtualReference(expression, baseTable)) return [];
			return [[field, mapColumnsInSQLToAlias(expression, aliasName)]];
		}),
	);
	return { table, state: { ...state, virtuals } };
}

function hasUnsafeRelationVirtualReference(
	expression: SQL,
	baseTable: PgTable,
): boolean {
	const tableName = getTableName(baseTable);
	const qualifiedName = new RegExp(
		`(?:^|[^A-Za-z0-9_])(?:"[^"]+"\\s*\\.\\s*)?"?${escapeRegExp(tableName)}"?\\s*\\.`,
	);
	const visit = (chunk: unknown): boolean => {
		if (!chunk || typeof chunk !== "object") return false;
		if ("table" in chunk && "name" in chunk) {
			const table = (chunk as { table?: unknown }).table;
			if (table && typeof table === "object") {
				try {
					return getTableName(table as PgTable) !== tableName;
				} catch {
					return true;
				}
			}
		}
		if ("value" in chunk) {
			const value = (chunk as { value?: unknown }).value;
			if (
				Array.isArray(value) &&
				value.some(
					(part) => typeof part === "string" && qualifiedName.test(part),
				)
			) {
				return true;
			}
		}
		if ("queryChunks" in chunk) {
			const children = (chunk as { queryChunks?: unknown }).queryChunks;
			if (Array.isArray(children) && children.some(visit)) return true;
		}
		if ("sql" in chunk) return visit((chunk as { sql?: unknown }).sql);
		return false;
	};
	return visit(expression);
}

/**
 * Build WHERE clause for relation filtering
 *
 * @param relation - The relation configuration
 * @param relationValue - The filter value for the relation
 * @param options - Options for building the clause
 * @returns SQL condition or undefined
 */
export function buildRelationWhereClause(
	relation: RelationConfig,
	relationValue: any,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	const { app } = options;

	if (!app) return undefined;

	const normalizedValue = relationValue === true ? {} : relationValue;
	if (
		!normalizedValue ||
		typeof normalizedValue !== "object" ||
		Array.isArray(normalizedValue)
	) {
		return undefined;
	}

	const relationFilter = normalizedValue as Record<string, any>;
	const decisions = options.failClosedAccess
		? undefined
		: (relationFilter as { [RELATION_READ_ACCESS]?: RelationReadDecisions })[
				RELATION_READ_ACCESS
			];
	const unauthorized = () =>
		new Error(
			`Relation predicate on '${options.parentState.name}' reached SQL without the caller's read access to '${relation.collection}'`,
		);
	if (
		!options.failClosedAccess &&
		!decisions &&
		options.context?.accessMode === "user"
	) {
		throw unauthorized();
	}

	const clauses: SQL[] = [];
	for (const { slot, where } of relationReads(relation, relationFilter)) {
		let readOptions = options;
		if (decisions) {
			const readAccess = decisions[slot];
			if (!readAccess) throw unauthorized();
			readOptions = { ...options, readAccess };
		}
		const existsClause = buildRelationExistsClause(
			relation,
			slotWhere(slot, where),
			readOptions,
		);
		if (existsClause) {
			clauses.push(
				slot === "is" || slot === "some" ? existsClause : not(existsClause),
			);
		}
	}

	return clauses.length > 0 ? and(...clauses) : undefined;
}

/**
 * Build EXISTS clause for relation filtering
 *
 * @param relation - The relation configuration
 * @param relationWhere - The WHERE filter for the relation
 * @param options - Options for building the clause
 * @returns SQL EXISTS clause or undefined
 */
export function buildRelationExistsClause(
	relation: RelationConfig,
	relationWhere: Where | undefined,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	// A relation the caller may not read is empty: nothing exists in it.
	if (
		options.readAccess?.target === false ||
		options.readAccess?.through === false
	) {
		return sql`false`;
	}
	switch (relation.type) {
		case "one":
			return buildBelongsToExistsClause(relation, relationWhere, options);
		case "many":
			return buildHasManyExistsClause(relation, relationWhere, options);
		case "manyToMany":
			return buildManyToManyExistsClause(relation, relationWhere, options);
		default:
			return undefined;
	}
}

/**
 * Build EXISTS clause for belongsTo (one) relations
 */
export function buildBelongsToExistsClause(
	relation: RelationConfig,
	relationWhere: Where | undefined,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	const { app, parentTable, context } = options;

	// Support both `field: string` (singular) and `fields: PgColumn[]` (array) formats
	const hasFieldConfig =
		(relation.fields && relation.fields.length > 0) || relation.field;

	if (!app || !hasFieldConfig || !relation.references) {
		return undefined;
	}

	const relatedCrud = app.collections[relation.collection];
	const relatedTarget = relationQueryTarget(
		relatedCrud["~internalRelatedTable"],
		relatedCrud["~internalState"],
		options,
	);
	const relatedTable = relatedTarget.table;
	const relatedState = relatedTarget.state;

	// Build join conditions supporting both formats
	let joinConditions: SQL[] = [];

	if (relation.field && typeof relation.field === "string") {
		// String field format: field: "image", references: "id"
		const sourceColumn = getColumn(parentTable, relation.field);
		const targetFieldName = Array.isArray(relation.references)
			? relation.references[0]
			: (relation.references as string);
		const targetColumn = targetFieldName
			? getColumn(relatedTable, targetFieldName)
			: undefined;

		if (sourceColumn && targetColumn) {
			joinConditions.push(
				eq(
					targetColumn,
					options.parentRecord &&
						Object.hasOwn(options.parentRecord, relation.field)
						? options.parentRecord[relation.field]
						: sourceColumn,
				),
			);
		}
	} else if (relation.fields && relation.fields.length > 0) {
		// Array field format: fields: [table.userId], references: ["id"]
		// Note: relation.fields may contain builders or columns - we need to resolve to actual table columns
		joinConditions = relation.fields
			.map((sourceField, index) => {
				const refs = relation.references as string[];
				const targetFieldName = refs?.[index];
				const targetColumn = targetFieldName
					? getColumn(relatedTable, targetFieldName)
					: undefined;
				// Get the actual column from the table by matching the name
				const sourceFieldName =
					(sourceField as { name?: string })?.name ??
					(sourceField as { config?: { name?: string } })?.config?.name;
				const sourceColumn = sourceFieldName
					? getColumn(parentTable, sourceFieldName)
					: undefined;
				return targetColumn && sourceColumn
					? eq(
							targetColumn,
							options.parentRecord &&
								Object.hasOwn(options.parentRecord, sourceFieldName!)
								? options.parentRecord[sourceFieldName!]
								: sourceColumn,
						)
					: undefined;
			})
			.filter(Boolean) as SQL[];
	}

	if (joinConditions.length === 0) return undefined;

	const whereConditions: SQL[] = [...joinConditions];

	const translations = relationTranslations(
		relatedTable,
		relatedState,
		relatedCrud["~internalI18nTable"],
		[relationWhere, options.readAccess?.target],
		`qp_relation_${options.relationAliasDepth ?? 0}_i18n`,
		context,
	);

	if (relationWhere) {
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: translations.current,
			i18nFallbackTable: translations.fallback,
			context,
			app,
			useI18n: translations.current !== null,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
			relationAliasDepth: (options.relationAliasDepth ?? 0) + 1,
		});
		if (nestedClause) whereConditions.push(nestedClause);
	}

	const accessClause = readAccessClause(
		options.readAccess?.target,
		relatedTable,
		relatedState,
		translations,
		options,
	);
	if (accessClause) whereConditions.push(accessClause);

	if (relatedState.options?.softDelete) {
		const deletedAtCol = getColumn(relatedTable, "deletedAt");
		if (deletedAtCol) {
			whereConditions.push(sql`${deletedAtCol} IS NULL`);
		}
	}

	const db = getDb(options.db, context);
	let subquery = db.select({ one: sql`1` }).from(relatedTable);
	for (const [table, on] of translations.joins) {
		subquery = subquery.leftJoin(table, on);
	}

	return sql`exists (${subquery.where(and(...whereConditions))})`;
}

/**
 * Build EXISTS clause for hasMany (many) relations
 */
export function buildHasManyExistsClause(
	relation: RelationConfig,
	relationWhere: Where | undefined,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	const { app, parentTable, context } = options;

	if (!app || relation.fields) return undefined;

	const relatedCrud = app.collections[relation.collection];
	const relatedTarget = relationQueryTarget(
		relatedCrud["~internalRelatedTable"],
		relatedCrud["~internalState"],
		options,
	);
	const relatedTable = relatedTarget.table;
	const relatedState = relatedTarget.state;
	const reverseRelationName = relation.relationName;
	const reverseRelation = reverseRelationName
		? relatedState.relations?.[reverseRelationName]
		: undefined;

	if (!reverseRelation?.fields || !reverseRelation.references?.length) {
		return undefined;
	}

	// Note: reverseRelation.fields may contain builders or columns - we need to resolve to actual table columns
	const joinConditions = reverseRelation.fields
		.map((foreignField: unknown, index: number) => {
			const parentFieldName = reverseRelation.references?.[index];
			const parentColumn = parentFieldName
				? getColumn(parentTable, parentFieldName)
				: undefined;
			// Get the actual column from the related table by matching the name
			const ff = foreignField as
				| { name?: string; config?: { name?: string } }
				| undefined;
			const foreignFieldName = ff?.name ?? ff?.config?.name;
			const foreignColumn = foreignFieldName
				? getColumn(relatedTable, foreignFieldName)
				: undefined;
			return parentColumn && foreignColumn
				? eq(
						foreignColumn,
						options.parentRecord &&
							Object.hasOwn(options.parentRecord, parentFieldName!)
							? options.parentRecord[parentFieldName!]
							: parentColumn,
					)
				: undefined;
		})
		.filter(Boolean) as SQL[];

	if (joinConditions.length === 0) return undefined;

	const whereConditions: SQL[] = [...joinConditions];

	const translations = relationTranslations(
		relatedTable,
		relatedState,
		relatedCrud["~internalI18nTable"],
		[relationWhere, options.readAccess?.target],
		`qp_relation_${options.relationAliasDepth ?? 0}_i18n`,
		context,
	);

	if (relationWhere) {
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: translations.current,
			i18nFallbackTable: translations.fallback,
			context,
			app,
			useI18n: translations.current !== null,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
			relationAliasDepth: (options.relationAliasDepth ?? 0) + 1,
		});
		if (nestedClause) whereConditions.push(nestedClause);
	}

	const accessClause = readAccessClause(
		options.readAccess?.target,
		relatedTable,
		relatedState,
		translations,
		options,
	);
	if (accessClause) whereConditions.push(accessClause);

	if (relatedState.options?.softDelete) {
		const deletedAtCol = getColumn(relatedTable, "deletedAt");
		if (deletedAtCol) {
			whereConditions.push(sql`${deletedAtCol} IS NULL`);
		}
	}

	const db = getDb(options.db, context);
	let subquery = db.select({ one: sql`1` }).from(relatedTable);
	for (const [table, on] of translations.joins) {
		subquery = subquery.leftJoin(table, on);
	}

	return sql`exists (${subquery.where(and(...whereConditions))})`;
}

/**
 * Build EXISTS clause for manyToMany relations
 */
export function buildManyToManyExistsClause(
	relation: RelationConfig,
	relationWhere: Where | undefined,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	const { app, parentTable, context } = options;

	if (!app || !relation.through) return undefined;

	const relatedCrud = app.collections[relation.collection];
	const junctionCrud = app.collections[relation.through];
	const relatedTarget = relationQueryTarget(
		relatedCrud["~internalRelatedTable"],
		relatedCrud["~internalState"],
		options,
	);
	const relatedTable = relatedTarget.table;
	const junctionTable = junctionCrud["~internalRelatedTable"];
	const relatedState = relatedTarget.state;
	const junctionState = junctionCrud["~internalState"];

	const sourceKey = relation.sourceKey || "id";
	const targetKey = relation.targetKey || "id";
	const sourceField = relation.sourceField;
	const targetField = relation.targetField;

	const parentColumn = getColumn(parentTable, sourceKey);
	const relatedColumn = getColumn(relatedTable, targetKey);
	const junctionSourceColumn = sourceField
		? getColumn(junctionTable, sourceField)
		: undefined;
	const junctionTargetColumn = targetField
		? getColumn(junctionTable, targetField)
		: undefined;

	if (
		!parentColumn ||
		!relatedColumn ||
		!junctionSourceColumn ||
		!junctionTargetColumn
	) {
		return undefined;
	}

	const whereConditions: SQL[] = [
		eq(
			junctionSourceColumn,
			options.parentRecord && Object.hasOwn(options.parentRecord, sourceKey)
				? options.parentRecord[sourceKey]
				: parentColumn,
		),
	];

	const depth = options.relationAliasDepth ?? 0;
	const translations = relationTranslations(
		relatedTable,
		relatedState,
		relatedCrud["~internalI18nTable"],
		[relationWhere, options.readAccess?.target],
		`qp_relation_${depth}_i18n`,
		context,
	);
	const throughTranslations = relationTranslations(
		junctionTable,
		junctionState,
		junctionCrud["~internalI18nTable"],
		[options.readAccess?.through],
		`qp_relation_${depth}_through_i18n`,
		context,
	);

	if (relationWhere) {
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: translations.current,
			i18nFallbackTable: translations.fallback,
			context,
			app,
			useI18n: translations.current !== null,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
			relationAliasDepth: depth + 1,
		});
		if (nestedClause) whereConditions.push(nestedClause);
	}

	for (const accessClause of [
		readAccessClause(
			options.readAccess?.target,
			relatedTable,
			relatedState,
			translations,
			options,
		),
		readAccessClause(
			options.readAccess?.through,
			junctionTable,
			junctionState,
			throughTranslations,
			options,
		),
	]) {
		if (accessClause) whereConditions.push(accessClause);
	}

	if (junctionState.options?.softDelete) {
		const junctionDeletedAt = getColumn(junctionTable, "deletedAt");
		if (junctionDeletedAt) {
			whereConditions.push(sql`${junctionDeletedAt} IS NULL`);
		}
	}

	if (relatedState.options?.softDelete) {
		const relatedDeletedAt = getColumn(relatedTable, "deletedAt");
		if (relatedDeletedAt) {
			whereConditions.push(sql`${relatedDeletedAt} IS NULL`);
		}
	}

	const db = getDb(options.db, context);
	let subquery = db
		.select({ one: sql`1` })
		.from(junctionTable)
		.innerJoin(relatedTable, eq(junctionTargetColumn, relatedColumn));
	for (const [table, on] of [
		...translations.joins,
		...throughTranslations.joins,
	]) {
		subquery = subquery.leftJoin(table, on);
	}

	return sql`exists (${subquery.where(and(...whereConditions))})`;
}

/**
 * The caller's read access to one table of a relation set, compiled over that
 * table as the trusted access predicate it is.
 */
function readAccessClause(
	access: boolean | AccessWhere | undefined,
	table: PgTable,
	state: CollectionBuilderState,
	translations: RelationTranslations,
	options: BuildRelationWhereOptions,
): SQL | undefined {
	if (access === undefined || typeof access === "boolean") return undefined;
	return buildWhereClause(access, {
		table,
		state,
		i18nCurrentTable: translations.current,
		i18nFallbackTable: translations.fallback,
		context: options.context,
		app: options.app,
		useI18n: translations.current !== null,
		db: options.db,
		failClosedAccess: true,
		relationAliasDepth: (options.relationAliasDepth ?? 0) + 1,
	});
}

type RelationTranslations = {
	current: PgTable | null;
	fallback: PgTable | null;
	joins: Array<[PgTable, SQL | undefined]>;
};

/**
 * Translation joins for one relation subquery, built like the main read's,
 * when a predicate compiled over the subquery's table names one of its
 * localized fields. Without them the field would compile to a bare column
 * name, which SQL resolves against an OUTER table that has one.
 */
function relationTranslations(
	table: PgTable,
	state: CollectionBuilderState,
	i18nTable: PgTable | null,
	wheres: unknown[],
	aliasName: string,
	context: CRUDContext | undefined,
): RelationTranslations {
	if (!wheres.some((where) => namesLocalizedField(where, state))) {
		return { current: null, fallback: null, joins: [] };
	}
	if (!i18nTable) {
		throw new Error(
			`Cannot compile localized relation predicate '${state.name}' without its translation table`,
		);
	}
	const locale = context?.locale ?? context?.defaultLocale ?? DEFAULT_LOCALE;
	const defaultLocale = context?.defaultLocale ?? DEFAULT_LOCALE;
	const id = getColumn(table, "id")!;
	const translation = (
		name: string,
		translationLocale: string,
	): [PgTable, SQL | undefined] => {
		const translated = alias(i18nTable, name);
		return [
			translated,
			and(
				eq(getColumn(translated, "parentId")!, id),
				eq(getColumn(translated, "locale")!, translationLocale),
			),
		];
	};
	const current = translation(aliasName, locale);
	const fallback =
		context?.localeFallback !== false && locale !== defaultLocale
			? translation(`${aliasName}_fallback`, defaultLocale)
			: undefined;
	return {
		current: current[0],
		fallback: fallback?.[0] ?? null,
		joins: fallback ? [current, fallback] : [current],
	};
}

/** Whether a where names a localized field of `state` outside its relations. */
function namesLocalizedField(
	where: unknown,
	state: CollectionBuilderState,
): boolean {
	if (!where || typeof where !== "object") return false;
	return Object.entries(where).some(([key, value]) => {
		if ((key === "AND" || key === "OR") && Array.isArray(value)) {
			return value.some((entry) => namesLocalizedField(entry, state));
		}
		if (key === "NOT") return namesLocalizedField(value, state);
		// A raw predicate receives the translation tables and may use them.
		if (key === "RAW") return state.localized.length > 0;
		return (state.localized as readonly string[]).includes(key);
	});
}

function accessCompilationError(
	collection: string,
	field: string,
	operator?: string,
): Error {
	const suffix = operator ? ` (operator '${operator}')` : "";
	return new Error(
		`Cannot compile access predicate '${collection}.${field}'${suffix}`,
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
