/**
 * HasMany Relation Resolver
 *
 * Resolves "many" relations where the related collection has a foreign key
 * pointing back to this collection.
 */

import { and, avg, count, inArray, max, min, type SQL, sum } from "drizzle-orm";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import type { buildWhereClause as BuildWhereClauseFn } from "#questpie/server/collection/crud/query-builders/where-builder.js";
import type { resolveFieldKey as ResolveFieldKeyFn } from "#questpie/server/collection/crud/shared/field-resolver.js";
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
  /** CMS instance for building where clauses */
  cms?: any;
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
    db,
    resolveFieldKey,
    buildWhereClause,
    cms,
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

  const relatedTable = relatedCrud["~internalRelatedTable"];
  const foreignKeyCol = relatedTable[foreignKeyField];

  // Build select clause with aggregations
  const selectClause: Record<string, any> = {
    [foreignKeyField]: foreignKeyCol,
  };

  if (nestedOptions._count) {
    selectClause._count = count().as("_count");
  }

  if (nestedOptions._aggregate) {
    const agg = nestedOptions._aggregate;
    if (agg._count) {
      selectClause._count = count().as("_count");
    }
    if (agg._sum) {
      for (const [field, enabled] of Object.entries(agg._sum)) {
        if (enabled && relatedTable[field]) {
          selectClause[`_sum_${field}`] = sum(relatedTable[field]).as(
            `_sum_${field}`,
          );
        }
      }
    }
    if (agg._avg) {
      for (const [field, enabled] of Object.entries(agg._avg)) {
        if (enabled && relatedTable[field]) {
          selectClause[`_avg_${field}`] = avg(relatedTable[field]).as(
            `_avg_${field}`,
          );
        }
      }
    }
    if (agg._min) {
      for (const [field, enabled] of Object.entries(agg._min)) {
        if (enabled && relatedTable[field]) {
          selectClause[`_min_${field}`] = min(relatedTable[field]).as(
            `_min_${field}`,
          );
        }
      }
    }
    if (agg._max) {
      for (const [field, enabled] of Object.entries(agg._max)) {
        if (enabled && relatedTable[field]) {
          selectClause[`_max_${field}`] = max(relatedTable[field]).as(
            `_max_${field}`,
          );
        }
      }
    }
  }

  // Build where conditions
  const whereConditions: SQL[] = [
    inArray(foreignKeyCol, Array.from(parentIds)),
  ];

  if (nestedOptions.where) {
    // Note: For relation resolvers, we don't use i18n fallback (useI18n: false)
    const additionalWhere = buildWhereClause(nestedOptions.where, {
      table: relatedTable,
      state: relatedCrud["~internalState"],
      i18nCurrentTable: relatedCrud["~internalI18nTable"],
      i18nFallbackTable: null,
      context,
      cms,
      useI18n: false,
      db,
    });
    if (additionalWhere) {
      whereConditions.push(additionalWhere);
    }
  }

  // Execute aggregation query
  const aggregateResults = await db
    .select(selectClause)
    .from(relatedTable)
    .where(and(...whereConditions))
    .groupBy(foreignKeyCol);

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
