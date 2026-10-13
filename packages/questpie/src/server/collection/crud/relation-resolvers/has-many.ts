/**
 * HasMany Relation Resolver
 *
 * Resolves "many" relations where the related collection has a foreign key
 * pointing back to this collection.
 */

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import type { buildWhereClause as BuildWhereClauseFn } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import type { resolveFieldKey as ResolveFieldKeyFn } from "#questpie/server/collection/crud/shared/field-resolver.js";
import { relationAggregateOf } from "#questpie/server/collection/crud/shared/relation-aggregate.js";
import type {
	CRUD,
	CRUDContext,
} from "#questpie/server/collection/crud/types.js";

/**
 * Options for resolving hasMany relations
 */
export interface ResolveHasManyOptions {
	/** Rows to resolve relations for */
	rows: Record<string, any>[];
	/** Name of the relation */
	relationName: string;
	/** Relation configuration */
	relation: RelationConfig;
	/** CRUD instance for the related collection */
	relatedCrud: CRUD;
	/** Nested query options for the relation */
	nestedOptions: Record<string, any>;
	/** CRUD context */
	context: CRUDContext;
	/** Database client */
	db: any;
	/** Function to resolve field keys */
	resolveFieldKey: typeof ResolveFieldKeyFn;
	/** Function to build WHERE clauses */
	buildWhereClause: typeof BuildWhereClauseFn;
	/** app instance for building where clauses */
	app?: any;
}

/**
 * Resolve hasMany relations for rows (without aggregation)
 *
 * HasMany relations are characterized by:
 * - relation.type === "many"
 * - relation.fields is empty/undefined (FK on related table)
 *
 * @param options - Resolution options
 */
export async function resolveHasManyRelation(
	options: ResolveHasManyOptions,
): Promise<void> {
	const {
		rows,
		relationName,
		relation,
		relatedCrud,
		nestedOptions,
		context,
		resolveFieldKey,
	} = options;

	if (rows.length === 0) return;

	const reverseRelationName = relation.relationName;
	if (!reverseRelationName) return;

	const reverseRelation =
		relatedCrud["~internalState"].relations?.[reverseRelationName];
	if (!reverseRelation?.fields || reverseRelation.fields.length === 0) return;

	const foreignKeyField =
		resolveFieldKey(
			relatedCrud["~internalState"],
			reverseRelation.fields[0],
			relatedCrud["~internalRelatedTable"],
		) ?? reverseRelation.fields[0].name;
	const primaryKeyField = reverseRelation.references?.[0] || "id";

	// Collect parent IDs
	const parentIds = new Set(
		rows
			.map((row) => row[primaryKeyField])
			.filter((id) => id !== null && id !== undefined),
	);

	if (parentIds.size === 0) return;

	// Build query options
	const relatedWhere: any = {
		[foreignKeyField]: { in: Array.from(parentIds) },
	};

	if (nestedOptions.where) {
		relatedWhere.AND = [nestedOptions.where];
	}

	const queryOptions = { ...nestedOptions };
	if (queryOptions.columns) {
		queryOptions.columns = {
			...queryOptions.columns,
			[foreignKeyField]: true,
		};
	}

	// Fetch related records
	const { docs: relatedRows } = await relatedCrud.find(
		{
			...queryOptions,
			where: relatedWhere,
		},
		context,
	);

	// Build lookup map (parent ID -> related rows)
	const relatedMap = new Map<any, any[]>();
	for (const relatedRow of relatedRows) {
		const parentId = (relatedRow as Record<string, any>)[foreignKeyField];
		if (!relatedMap.has(parentId)) {
			relatedMap.set(parentId, []);
		}
		relatedMap.get(parentId)?.push(relatedRow);
	}

	// Assign related records to rows
	for (const row of rows) {
		const parentId = row[primaryKeyField];
		row[relationName] = relatedMap.get(parentId) || [];
	}
}

/**
 * Resolve hasMany relations with aggregation (_count, _sum, _avg, _min, _max)
 *
 * @param options - Resolution options
 */
export async function resolveHasManyWithAggregation(
	options: ResolveHasManyOptions,
): Promise<void> {
	const {
		rows,
		relationName,
		relation,
		relatedCrud,
		nestedOptions,
		context,
		resolveFieldKey,
	} = options;

	if (rows.length === 0) return;

	const reverseRelationName = relation.relationName;
	if (!reverseRelationName) return;

	const reverseRelation =
		relatedCrud["~internalState"].relations?.[reverseRelationName];
	if (!reverseRelation?.fields || reverseRelation.fields.length === 0) return;

	const foreignKeyField =
		resolveFieldKey(
			relatedCrud["~internalState"],
			reverseRelation.fields[0],
			relatedCrud["~internalRelatedTable"],
		) ?? reverseRelation.fields[0].name;
	const primaryKeyField = reverseRelation.references?.[0] || "id";

	// Collect parent IDs
	const parentIds = new Set(
		rows
			.map((row) => row[primaryKeyField])
			.filter((id) => id !== null && id !== undefined),
	);

	if (parentIds.size === 0) return;

	// The target collection runs the aggregate through its own read pipeline
	// (access rule, where, soft delete, transaction) and intersects the parent
	// ids in SQL; this resolver only groups the result back onto the parents.
	const aggregateResults = await relationAggregateOf(relatedCrud)(
		nestedOptions,
		context,
		{
			field: foreignKeyField,
			parentIds: Array.from(parentIds),
			count: nestedOptions._count,
			values: nestedOptions._aggregate,
		},
	);

	// Build lookup map with aggregation results
	const aggregateMap = new Map<any, Record<string, any>>();
	for (const result of aggregateResults) {
		const parentId = result[foreignKeyField];
		const aggData: Record<string, any> = {};

		if (result._count !== undefined) {
			aggData._count = Number(result._count);
		}

		for (const key of Object.keys(result)) {
			if (key.startsWith("_sum_")) {
				if (!aggData._sum) aggData._sum = {};
				aggData._sum[key.replace("_sum_", "")] = Number(result[key]) || 0;
			} else if (key.startsWith("_avg_")) {
				if (!aggData._avg) aggData._avg = {};
				aggData._avg[key.replace("_avg_", "")] = Number(result[key]) || 0;
			} else if (key.startsWith("_min_")) {
				if (!aggData._min) aggData._min = {};
				aggData._min[key.replace("_min_", "")] = result[key];
			} else if (key.startsWith("_max_")) {
				if (!aggData._max) aggData._max = {};
				aggData._max[key.replace("_max_", "")] = result[key];
			}
		}

		aggregateMap.set(parentId, aggData);
	}

	// Assign aggregation results to rows
	for (const row of rows) {
		const parentId = row[primaryKeyField];
		row[relationName] = aggregateMap.get(parentId) || { _count: 0 };
	}
}
