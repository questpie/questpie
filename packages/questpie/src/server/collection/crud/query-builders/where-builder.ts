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
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";

import type {
	CollectionBuilderState,
	RelationConfig,
} from "#questpie/server/collection/builder/types.js";
import { isAccessWhere } from "#questpie/server/collection/crud/shared/access-control.js";
import {
	getColumn,
	getDb,
} from "#questpie/server/collection/crud/shared/index.js";
import type {
	CRUDContext,
	Where,
} from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { ApiError } from "#questpie/server/errors/base.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { Field } from "#questpie/server/fields/field-class.js";
import type { OperatorFn } from "#questpie/server/fields/types.js";
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
					}),
				)
				.filter(Boolean) as SQL[];
			if (subClauses.length > 0) {
				conditions.push(or(...subClauses)!);
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
			});
			if (subClause) {
				conditions.push(not(subClause));
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
			const standardFieldOperators = [
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
			const relationQuantifiers = ["some", "none", "every", "is", "isNot"];
			const valueKeys = Object.keys(value as Record<string, any>);

			// A key is a field operator if it's in the standard list OR in the field's operator map
			const hasFieldOperators = valueKeys.some(
				(k) =>
					standardFieldOperators.includes(k) ||
					(fieldColumnOps && k in fieldColumnOps),
			);
			const hasRelationQuantifiers = valueKeys.some((k) =>
				relationQuantifiers.includes(k),
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
	const { app, context: _context } = options;

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
	const hasQuantifiers = ["some", "none", "every", "is", "isNot"].some(
		(key) => key in relationFilter,
	);

	const clauses: SQL[] = [];

	if (relation.type === "one") {
		const isWhere =
			relationFilter.is ??
			relationFilter.some ??
			(hasQuantifiers ? undefined : relationFilter);
		const isNotWhere = relationFilter.isNot;

		if (isWhere !== undefined) {
			const existsClause = buildRelationExistsClause(
				relation,
				isWhere,
				options,
			);
			if (existsClause) clauses.push(existsClause);
		}

		if (isNotWhere !== undefined) {
			const existsClause = buildRelationExistsClause(
				relation,
				isNotWhere,
				options,
			);
			if (existsClause) clauses.push(not(existsClause));
		}
	} else if (relation.type === "many" || relation.type === "manyToMany") {
		const someWhere =
			relationFilter.some ?? (hasQuantifiers ? undefined : relationFilter);
		const noneWhere = relationFilter.none;
		const everyWhere = relationFilter.every;

		if (someWhere !== undefined) {
			const existsClause = buildRelationExistsClause(
				relation,
				someWhere,
				options,
			);
			if (existsClause) clauses.push(existsClause);
		}

		if (noneWhere !== undefined) {
			const existsClause = buildRelationExistsClause(
				relation,
				noneWhere,
				options,
			);
			if (existsClause) clauses.push(not(existsClause));
		}

		if (everyWhere !== undefined) {
			const negatedWhere = { NOT: everyWhere } as Where;
			const existsClause = buildRelationExistsClause(
				relation,
				negatedWhere,
				options,
			);
			if (existsClause) clauses.push(not(existsClause));
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
	const relatedTable = relatedCrud["~internalRelatedTable"];
	const relatedState = relatedCrud["~internalState"];

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
			joinConditions.push(eq(targetColumn, sourceColumn));
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
					? eq(targetColumn, sourceColumn)
					: undefined;
			})
			.filter(Boolean) as SQL[];
	}

	if (joinConditions.length === 0) return undefined;

	const whereConditions: SQL[] = [...joinConditions];

	if (relationWhere) {
		// Note: For relation subqueries, we don't use i18n fallback (useI18n: false)
		// The related collection's i18n table is passed but not used for WHERE
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: relatedCrud["~internalI18nTable"],
			i18nFallbackTable: null,
			context,
			app,
			useI18n: false,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
		});
		if (nestedClause) whereConditions.push(nestedClause);
	}

	if (relatedState.options?.softDelete) {
		const deletedAtCol = getColumn(relatedTable, "deletedAt");
		if (deletedAtCol) {
			whereConditions.push(sql`${deletedAtCol} IS NULL`);
		}
	}

	const db = getDb(options.db, context);
	const subquery = db
		.select({ one: sql`1` })
		.from(relatedTable)
		.where(and(...whereConditions));

	return sql`exists (${subquery})`;
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
	const relatedTable = relatedCrud["~internalRelatedTable"];
	const relatedState = relatedCrud["~internalState"];
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
				? eq(foreignColumn, parentColumn)
				: undefined;
		})
		.filter(Boolean) as SQL[];

	if (joinConditions.length === 0) return undefined;

	const whereConditions: SQL[] = [...joinConditions];

	if (relationWhere) {
		// Note: For relation subqueries, we don't use i18n fallback (useI18n: false)
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: relatedCrud["~internalI18nTable"],
			i18nFallbackTable: null,
			context,
			app,
			useI18n: false,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
		});
		if (nestedClause) whereConditions.push(nestedClause);
	}

	if (relatedState.options?.softDelete) {
		const deletedAtCol = getColumn(relatedTable, "deletedAt");
		if (deletedAtCol) {
			whereConditions.push(sql`${deletedAtCol} IS NULL`);
		}
	}

	const db = getDb(options.db, context);
	const subquery = db
		.select({ one: sql`1` })
		.from(relatedTable)
		.where(and(...whereConditions));

	return sql`exists (${subquery})`;
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
	const relatedTable = relatedCrud["~internalRelatedTable"];
	const junctionTable = junctionCrud["~internalRelatedTable"];
	const relatedState = relatedCrud["~internalState"];
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

	const whereConditions: SQL[] = [eq(junctionSourceColumn, parentColumn)];

	if (relationWhere) {
		// Note: For relation subqueries, we don't use i18n fallback (useI18n: false)
		const nestedClause = buildWhereClause(relationWhere, {
			table: relatedTable,
			state: relatedState,
			i18nCurrentTable: relatedCrud["~internalI18nTable"],
			i18nFallbackTable: null,
			context,
			app,
			useI18n: false,
			db: options.db,
			failClosedAccess: options.failClosedAccess,
		});
		if (nestedClause) whereConditions.push(nestedClause);
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
	const subquery = db
		.select({ one: sql`1` })
		.from(junctionTable)
		.innerJoin(relatedTable, eq(junctionTargetColumn, relatedColumn))
		.where(and(...whereConditions));

	return sql`exists (${subquery})`;
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
