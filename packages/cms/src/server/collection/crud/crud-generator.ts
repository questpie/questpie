import type {
	CreateInput,
	CRUD,
	CRUDContext,
	DeleteParams,
	FindFirstOptions,
	FindManyOptions,
	QCMS,
	RestoreParams,
	UpdateParams,
	Where,
	With,
} from "#questpie/cms/exports/server";
import type {
	AccessWhere,
	CollectionAccess,
	CollectionBuilderState,
	CollectionHooks,
	CollectionOptions,
	HookContext,
	HookFunction,
	RelationConfig,
} from "#questpie/cms/server/collection/builder/types";
import type {
	Columns,
	Extras,
	FindVersionsOptions,
	OrderBy,
	RevertVersionOptions,
} from "#questpie/cms/server/collection/crud/types";
import { runWithCMSContext } from "#questpie/cms/server/config/context";
import {
	and,
	avg,
	count,
	eq,
	inArray,
	max,
	min,
	not,
	or,
	sql,
	sum,
	type SQL,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

export class CRUDGenerator<TState extends CollectionBuilderState> {
	// Public accessors for internal use by relation resolution
	public get relatedTable() {
		return this.table;
	}

	constructor(
		public state: TState,
		private table: PgTable,
		private i18nTable: PgTable | null,
		private versionsTable: PgTable | null,
		private i18nVersionsTable: PgTable | null,
		private db: any,
		private getVirtuals?: (context: any) => TState["virtuals"],
		private getTitle?: (context: any) => SQL | undefined,
		private getVirtualsForVersions?: (context: any) => TState["virtuals"],
		private getTitleForVersions?: (context: any) => SQL | undefined,
		_getRawTitle?: (context: any) => SQL | undefined,
		private cms?: QCMS<any>,
	) {}

	/**
	 * Generate CRUD operations
	 */
	generate(): CRUD {
		const findMany = this.wrapWithCMSContext(this.createFindMany());
		const findFirst = this.wrapWithCMSContext(this.createFindFirst());
		const updateMany = this.wrapWithCMSContext(this.createUpdateMany());
		const deleteMany = this.wrapWithCMSContext(this.createDeleteMany());
		const restoreById = this.wrapWithCMSContext(this.createRestore());

		const crud: CRUD = {
			find: findMany,
			findOne: findFirst,
			count: this.wrapWithCMSContext(this.createCount()),
			create: this.wrapWithCMSContext(this.createCreate()),
			updateById: this.wrapWithCMSContext(this.createUpdate()),
			update: updateMany,
			deleteById: this.wrapWithCMSContext(this.createDelete()),
			delete: deleteMany,
			restoreById,
			findVersions: this.wrapWithCMSContext(this.createFindVersions()),
			revertToVersion: this.wrapWithCMSContext(this.createRevertToVersion()),
		};
		crud["~internalState"] = this.state;
		crud["~internalRelatedTable"] = this.table;
		crud["~internalI18nTable"] = this.i18nTable;
		return crud;
	}

	private getDb(context?: CRUDContext) {
		return context?.db ?? this.db;
	}

	/**
	 * Normalize context with defaults
	 * @default accessMode: 'system' - CMS API is backend-only by default
	 */
	private normalizeContext(
		context: CRUDContext = {},
	): Required<Pick<CRUDContext, "accessMode" | "locale" | "defaultLocale">> &
		CRUDContext {
		return {
			...context,
			accessMode: context.accessMode ?? "system", // Default to system
			locale: context.locale ?? context.defaultLocale ?? "en",
			defaultLocale: context.defaultLocale ?? "en",
		};
	}

	private runWithCMSContext<TResult>(
		context: CRUDContext | undefined,
		fn: () => Promise<TResult>,
	): Promise<TResult> {
		if (!this.cms) {
			return fn();
		}

		const normalized = this.normalizeContext(context ?? {});
		return runWithCMSContext(this.cms, normalized, fn) as Promise<TResult>;
	}

	private wrapWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return (...args: TArgs) => {
			const context = (args.length > 1 ? args[1] : undefined) as
				| CRUDContext
				| undefined;
			return this.runWithCMSContext(context, () => fn(...args));
		};
	}

	/**
	 * Create findMany operation (like db.query.table.findMany)
	 * Uses Drizzle's core query builder directly
	 */
	private createFindMany() {
		return async (options: FindManyOptions = {}, context: CRUDContext = {}) => {
			const db = this.getDb(context);

			// Enforce access control
			const accessWhere = await this.enforceAccessControl(
				"read",
				context,
				null,
				options,
			);

			// Execute beforeRead hooks (read doesn't modify data)
			if (this.state.hooks?.beforeRead) {
				await this.executeHooks(
					this.state.hooks.beforeRead,
					this.createHookContext({
						data: options,
						operation: "read",
						context,
						db,
					}),
				);
			}

			const mergedWhere = this.mergeWhere(options.where, accessWhere);
			const includeDeleted = options.includeDeleted === true;

			// Get total count
			const countFn = this.createCount();
			const totalDocs = await countFn(
				{ where: mergedWhere, includeDeleted },
				{ ...context, accessMode: "system" },
			);

			// Determine if we are using i18n (i18n table exists)
			const useI18n = !!this.i18nTable;

			// Build SELECT object
			const selectObj = this.buildSelectObject(
				options.columns || (options as any).select,
				options.extras,
				context,
			);

			// Start building query
			let query = db.select(selectObj).from(this.table);

			// Add i18n join if locale provided and localized fields exist
			if (useI18n) {
				query = query.leftJoin(
					this.i18nTable,
					and(
						eq((this.i18nTable as any).parentId, (this.table as any).id),
						eq((this.i18nTable as any).locale, context.locale!),
					),
				);
			}

			// WHERE clause with soft delete filter
			const whereClauses: SQL[] = [];

			if (mergedWhere) {
				const whereClause = this.buildWhereClause(
					mergedWhere,
					useI18n,
					undefined,
					context,
				);
				if (whereClause) {
					whereClauses.push(whereClause);
				}
			}

			// Soft delete filter
			if (this.state.options.softDelete && !includeDeleted) {
				const softDeleteFilter = sql`${(this.table as any).deletedAt} IS NULL`;
				whereClauses.push(softDeleteFilter);
			}

			if (whereClauses.length > 0) {
				query = query.where(and(...whereClauses));
			}

			// ORDER BY
			if (options.orderBy) {
				const orderClauses = this.buildOrderByClauses(options.orderBy, useI18n);
				for (const clause of orderClauses) {
					query = query.orderBy(clause);
				}
			}

			// LIMIT
			if (options.limit !== undefined) {
				query = query.limit(options.limit);
			}

			// OFFSET
			if (options.offset !== undefined) {
				query = query.offset(options.offset);
			}

			// Execute query
			const rows = await query;

			// Handle relations
			if (options.with && this.cms) {
				await this.resolveRelations(rows, options.with, context);
			}

			// Execute afterRead hooks
			if (this.state.hooks?.afterRead) {
				for (const row of rows) {
					await this.executeHooks(
						this.state.hooks.afterRead,
						this.createHookContext({
							data: row,
							operation: "read",
							context,
							db,
						}),
					);
				}
			}

			// Construct paginated result
			const limit = options.limit ?? totalDocs;
			const totalPages = limit > 0 ? Math.ceil(totalDocs / limit) : 1;
			const offset = options.offset ?? 0;
			const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
			const pagingCounter = (page - 1) * limit + 1;
			const hasPrevPage = page > 1;
			const hasNextPage = page < totalPages;
			const prevPage = hasPrevPage ? page - 1 : null;
			const nextPage = hasNextPage ? page + 1 : null;

			return {
				docs: rows,
				totalDocs,
				limit,
				totalPages,
				page,
				pagingCounter,
				hasPrevPage,
				hasNextPage,
				prevPage,
				nextPage,
			};
		};
	}

	/**
	 * Create findFirst operation (like db.query.table.findOne()
	 * Uses Drizzle's core query builder directly
	 */
	private createFindFirst() {
		return async (
			options: FindFirstOptions = {},
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);

			// Execute beforeRead hooks (read doesn't modify data)
			if (this.state.hooks?.beforeRead) {
				await this.executeHooks(
					this.state.hooks.beforeRead,
					this.createHookContext({
						data: options,
						operation: "read",
						context,
						db,
					}),
				);
			}

			// Enforce access control
			const accessWhere = await this.enforceAccessControl(
				"read",
				context,
				null,
				options,
			);
			const mergedWhere = this.mergeWhere(options.where, accessWhere);
			const includeDeleted = options.includeDeleted === true;

			// Determine if we are using i18n
			const useI18n = !!(this.i18nTable && context.locale);

			// Build SELECT object
			const selectObj = this.buildSelectObject(
				options.columns || (options as any).select,
				options.extras,
				context,
			);

			// Start building query
			let query = db.select(selectObj).from(this.table);

			// Add i18n join if locale provided and localized fields exist
			if (useI18n) {
				query = query.leftJoin(
					this.i18nTable,
					and(
						eq((this.i18nTable as any).parentId, (this.table as any).id),
						eq((this.i18nTable as any).locale, context.locale!),
					),
				);
			}

			// WHERE clause with soft delete filter
			const whereClauses: SQL[] = [];

			if (mergedWhere) {
				const whereClause = this.buildWhereClause(
					mergedWhere,
					useI18n,
					undefined,
					context,
				);
				if (whereClause) {
					whereClauses.push(whereClause);
				}
			}

			// Soft delete filter
			if (this.state.options.softDelete && !includeDeleted) {
				const softDeleteFilter = sql`${(this.table as any).deletedAt} IS NULL`;
				whereClauses.push(softDeleteFilter);
			}

			if (whereClauses.length > 0) {
				query = query.where(and(...whereClauses));
			}

			// ORDER BY
			if (options.orderBy) {
				const orderClauses = this.buildOrderByClauses(options.orderBy, useI18n);
				for (const clause of orderClauses) {
					query = query.orderBy(clause);
				}
			}
			// LIMIT 1 (findFirst always returns single result)
			query = query.limit(1);

			// Execute query
			const rows = await query;
			const row = rows[0] || null;

			// Handle relations
			if (row && options.with && this.cms) {
				await this.resolveRelations([row], options.with, context);
			}

			// Execute afterRead hooks
			if (row && this.state.hooks?.afterRead) {
				await this.executeHooks(
					this.state.hooks.afterRead,
					this.createHookContext({
						data: row,
						operation: "read",
						context,
						db,
					}),
				);
			}

			return row;
		};
	}

	/**
	 * Create count operation
	 */
	private createCount() {
		return async (
			options: Pick<FindManyOptions, "where" | "includeDeleted"> = {},
			context: CRUDContext = {},
		): Promise<number> => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);

			// Enforce access control
			const accessWhere = await this.enforceAccessControl(
				"read",
				normalized,
				null,
				options,
			);
			const mergedWhere = this.mergeWhere(options.where, accessWhere);

			// Build WHERE clause (with soft delete filter)
			let whereClause: SQL<unknown> | undefined;
			if (mergedWhere) {
				whereClause = this.buildWhereClause(
					mergedWhere,
					false,
					undefined,
					context,
				);
			}

			// Add soft delete filter
			if (this.state.options.softDelete && !options.includeDeleted) {
				const softDeleteClause = sql`${(this.table as any).deletedAt} IS NULL`;
				whereClause = whereClause
					? and(whereClause, softDeleteClause)
					: softDeleteClause;
			}

			// Build count query
			let query = db.select({ count: count() }).from(this.table);

			if (whereClause) {
				query = query.where(whereClause);
			}

			const result = await query;
			return result[0]?.count ?? 0;
		};
	}

	/**
	 * Resolve relations recursively
	 */
	private async resolveRelations(
		rows: any[],
		withConfig: With,
		context: CRUDContext,
	) {
		if (!rows.length || !withConfig || !this.cms) return;
		const db = this.getDb(context);

		for (const [relationName, relationOptions] of Object.entries(withConfig)) {
			if (!relationOptions) continue;

			const relation = this.state.relations[relationName];
			if (!relation) continue;

			const relatedCrud = this.cms.api.collections[relation.collection];

			// Handle BelongsTo (One-to-One / Many-to-One)
			if (relation.fields && relation.fields.length > 0) {
				const sourceField = relation.fields[0];
				const targetFieldName = relation.references[0];

				const sourceColName =
					this.resolveFieldKey(this.state, sourceField, this.table) ??
					sourceField.name;

				// 1. Collect IDs
				const sourceIds = new Set(
					rows
						.map((r) => r[sourceColName])
						.filter((id) => id !== null && id !== undefined),
				);
				if (sourceIds.size === 0) continue;

				// 2. Query related
				const nestedOptions =
					typeof relationOptions === "object" ? relationOptions : {};
				const { docs: relatedRows } = await relatedCrud.find(
					{
						...nestedOptions,
						where: {
							// must be sure to merge with nested where
							...nestedOptions.where,
							// main condition, in clause
							[targetFieldName]: { in: Array.from(sourceIds) },
						},
					},
					context,
				);
				// 3. Map back
				const relatedMap = new Map();
				for (const row of relatedRows) {
					relatedMap.set(row[targetFieldName], row);
				}

				for (const row of rows) {
					const sourceId = row[sourceColName];
					if (sourceId !== null && sourceId !== undefined) {
						row[relationName] = relatedMap.get(sourceId) || null;
					}
				}
			}
			// Handle HasMany (One-to-Many)
			else if (relation.type === "many" && !relation.fields) {
				const reverseRelationName = relation.relationName;
				if (!reverseRelationName) continue;

				const reverseRelation =
					relatedCrud["~internalState"].relations?.[reverseRelationName];
				if (!reverseRelation?.fields || reverseRelation.fields.length === 0)
					continue;

				const foreignKeyField =
					this.resolveFieldKey(
						relatedCrud["~internalState"],
						reverseRelation.fields[0],
						relatedCrud["~internalRelatedTable"],
					) ?? reverseRelation.fields[0].name;
				const primaryKeyField = reverseRelation.references?.[0] || "id";

				// 1. Collect parent IDs
				const parentIds = new Set(
					rows
						.map((r) => r[primaryKeyField])
						.filter((id) => id !== null && id !== undefined),
				);
				if (parentIds.size === 0) continue;

				const nestedOptions =
					typeof relationOptions === "object" ? relationOptions : {};

				// Check if aggregation is requested
				if (nestedOptions._count || nestedOptions._aggregate) {
					// Perform aggregation query
					const relatedTable = relatedCrud["~internalRelatedTable"];
					const foreignKeyCol = relatedTable[foreignKeyField];

					// Build SELECT clause with aggregations
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

					// Build WHERE clause
					const whereConditions = [
						inArray(foreignKeyCol, Array.from(parentIds)),
					];

					if (nestedOptions.where) {
						const additionalWhere = this.buildWhereClause(
							nestedOptions.where,
							false,
							relatedTable,
							context,
							relatedCrud["~internalState"],
							relatedCrud["~internalI18nTable"],
						);
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

					// Map results back to rows
					const aggregateMap = new Map();
					for (const result of aggregateResults) {
						const parentId = result[foreignKeyField];
						const aggData: Record<string, any> = {};

						// Extract aggregate results
						if (result._count !== undefined) {
							aggData._count = Number(result._count);
						}

						// Extract _sum, _avg, _min, _max
						for (const key of Object.keys(result)) {
							if (key.startsWith("_sum_")) {
								if (!aggData._sum) aggData._sum = {};
								aggData._sum[key.replace("_sum_", "")] =
									Number(result[key]) || 0;
							} else if (key.startsWith("_avg_")) {
								if (!aggData._avg) aggData._avg = {};
								aggData._avg[key.replace("_avg_", "")] =
									Number(result[key]) || 0;
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

					// Attach aggregate data to rows
					for (const row of rows) {
						const parentId = row[primaryKeyField];
						row[relationName] = aggregateMap.get(parentId) || { _count: 0 };
					}
				} else {
					// Normal relation loading (non-aggregated)
					const relatedWhere: any = {
						[foreignKeyField]: { in: Array.from(parentIds) },
					};

					if (nestedOptions.where) {
						relatedWhere.AND = [nestedOptions.where];
					}

					// Ensure foreign key field is included in columns if partial selection is used
					// This is required for mapping back to parent records
					const queryOptions = { ...nestedOptions };
					if (queryOptions.columns) {
						queryOptions.columns = {
							...queryOptions.columns,
							[foreignKeyField]: true,
						};
					}

					const { docs: relatedRows } = await relatedCrud.find(
						{
							...queryOptions,
							where: relatedWhere,
						},
						context,
					);

					// 3. Group by parent ID
					const relatedMap = new Map<any, any[]>();
					for (const relatedRow of relatedRows) {
						const parentId = relatedRow[foreignKeyField];
						if (!relatedMap.has(parentId)) {
							relatedMap.set(parentId, []);
						}
						relatedMap.get(parentId)?.push(relatedRow);
					}

					// 4. Attach to rows as arrays
					for (const row of rows) {
						const parentId = row[primaryKeyField];
						row[relationName] = relatedMap.get(parentId) || [];
					}
				}
			}
			// Handle ManyToMany
			else if (relation.type === "manyToMany" && relation.through) {
				const sourceKey = relation.sourceKey || "id";
				const targetKey = relation.targetKey || "id";
				const sourceField = relation.sourceField;
				const targetField = relation.targetField;

				if (!sourceField || !targetField) continue;

				const junctionCrud = this.cms.api.collections[relation.through];

				// 1. Collect source IDs
				const sourceIds = new Set(
					rows
						.map((r) => r[sourceKey])
						.filter((id) => id !== null && id !== undefined),
				);
				if (sourceIds.size === 0) continue;

				// 2. Query junction table to get all links
				const { docs: junctionRows } = await junctionCrud.find(
					{
						where: { [sourceField]: { in: Array.from(sourceIds) } },
					},
					context,
				);

				if (!junctionRows.length) {
					// No links found, attach empty arrays
					for (const row of rows) {
						row[relationName] = [];
					}
					continue;
				}

				// 3. Collect target IDs from junction
				const targetIds = [
					...new Set(
						junctionRows
							.map((j: any) => j[targetField])
							.filter((id: any) => id !== null && id !== undefined),
					),
				];

				if (!targetIds.length) {
					// No target IDs found, attach empty arrays
					for (const row of rows) {
						row[relationName] = [];
					}
					continue;
				}

				// 4. Query related records
				const nestedOptions =
					typeof relationOptions === "object" ? relationOptions : {};

				const relatedWhere: any = {
					[targetKey]: { in: targetIds },
				};

				if (nestedOptions.where) {
					relatedWhere.AND = [nestedOptions.where];
				}

				const { docs: relatedRows } = await relatedCrud.find(
					{
						...nestedOptions,
						where: relatedWhere,
					},
					context,
				);

				// 5. Build mapping: sourceId -> targetIds[]
				const junctionMap = new Map<any, any[]>();
				for (const j of junctionRows) {
					const sid = j[sourceField];
					if (!junctionMap.has(sid)) {
						junctionMap.set(sid, []);
					}
					junctionMap.get(sid)?.push(j[targetField]);
				}

				// 6. Build related map: targetId -> row
				const relatedMap = new Map();
				for (const r of relatedRows) {
					relatedMap.set(r[targetKey], r);
				}

				// 7. Attach to rows as arrays
				for (const row of rows) {
					const sourceId = row[sourceKey];
					const targetIds = junctionMap.get(sourceId) || [];
					row[relationName] = targetIds
						.map((tid) => relatedMap.get(tid))
						.filter((r) => r !== undefined);
				}
			}
		}
	}

	/**
	 * Handle cascade delete operations for relations
	 *
	 * NOTE: Only handles application-level CASCADE to trigger hooks.
	 * Database FK constraints handle CASCADE/SET NULL/RESTRICT automatically.
	 */
	private async handleCascadeDelete(
		_id: string,
		record: any,
		context: CRUDContext,
	): Promise<void> {
		if (!this.cms || !this.state.relations) return;

		for (const [_relationName, relation] of Object.entries(
			this.state.relations,
		)) {
			// Skip if no action
			if (
				!relation.onDelete ||
				relation.onDelete === "no action" ||
				relation.onDelete === "restrict"
			)
				continue;

			// Handle HasMany
			if (relation.type === "many" && !relation.fields) {
				const reverseRelationName = relation.relationName;
				if (!reverseRelationName) continue;

				const relatedCrud = this.cms.api.collections[relation.collection];
				const reverseRelation =
					relatedCrud["~internalState"].relations?.[reverseRelationName];
				if (!reverseRelation?.fields || reverseRelation.fields.length === 0)
					continue;

				const foreignKeyField =
					this.resolveFieldKey(
						relatedCrud["~internalState"],
						reverseRelation.fields[0],
						relatedCrud["~internalRelatedTable"],
					) ?? reverseRelation.fields[0].name;
				const primaryKeyField = reverseRelation.references?.[0] || "id";

				// CASCADE
				if (relation.onDelete === "cascade") {
					const { docs: relatedRecords } = await relatedCrud.find(
						{
							where: { [foreignKeyField]: { eq: record[primaryKeyField] } },
						},
						context,
					);

					if (relatedRecords.length > 0) {
						// CASCADE: Delete related records (triggers hooks)
						for (const relatedRecord of relatedRecords) {
							await relatedCrud.deleteById({ id: relatedRecord.id }, context);
						}
					}
				}
				// SET NULL
				else if (relation.onDelete === "set null") {
					// Update related records to set FK to null
					// We use updateMany which triggers hooks
					await relatedCrud.update(
						{
							where: { [foreignKeyField]: { eq: record[primaryKeyField] } },
							data: { [foreignKeyField]: null },
						},
						context,
					);
				}
			}

			// Handle ManyToMany CASCADE (Only Cascade supported for now)
			else if (
				relation.type === "manyToMany" &&
				relation.through &&
				relation.onDelete === "cascade"
			) {
				const sourceField = relation.sourceField;
				const sourceKey = relation.sourceKey || "id";

				if (!sourceField) continue;

				const junctionCrud = this.cms.api.collections[relation.through];

				const { docs: junctionRecords } = await junctionCrud.find(
					{
						where: { [sourceField]: { eq: record[sourceKey] } },
					},
					context,
				);

				if (junctionRecords.length > 0) {
					// CASCADE: Delete junction records
					for (const junctionRecord of junctionRecords) {
						await junctionCrud.deleteById({ id: junctionRecord.id }, context);
					}
				}
			}
		}
	}

	/**
	 * Separate nested relation operations from regular fields
	 */
	private separateNestedRelations(input: any): {
		regularFields: any;
		nestedRelations: Record<string, any>;
	} {
		const regularFields: any = {};
		const nestedRelations: Record<string, any> = {};

		const relationNames = new Set(Object.keys(this.state.relations || {}));

		for (const [key, value] of Object.entries(input)) {
			if (
				relationNames.has(key) &&
				typeof value === "object" &&
				value !== null
			) {
				// This is a nested relation operation
				nestedRelations[key] = value;
			} else {
				// Regular field
				regularFields[key] = value;
			}
		}

		return { regularFields, nestedRelations };
	}

	private async applyBelongsToRelations(
		regularFields: Record<string, any>,
		nestedRelations: Record<string, any>,
		context: CRUDContext,
		tx: any,
	): Promise<{
		regularFields: Record<string, any>;
		nestedRelations: Record<string, any>;
	}> {
		if (!this.cms || !this.state.relations) {
			return { regularFields, nestedRelations };
		}

		const updatedFields = { ...regularFields };
		const remainingRelations = { ...nestedRelations };

		for (const [relationName, operations] of Object.entries(nestedRelations)) {
			const relation = this.state.relations[relationName];
			if (!relation || relation.type !== "one" || !relation.fields?.length) {
				continue;
			}

			const actionKeys = ["connect", "create", "connectOrCreate"].filter(
				(key) => operations?.[key] !== undefined,
			);

			if (actionKeys.length === 0) {
				delete remainingRelations[relationName];
				continue;
			}

			if (actionKeys.length > 1) {
				throw new Error(
					`Nested relation "${relationName}" supports only one operation at a time.`,
				);
			}

			const fieldKeys = relation.fields
				.map(
					(field) =>
						this.resolveFieldKey(this.state, field, this.table) ?? field?.name,
				)
				.filter(Boolean) as string[];

			if (fieldKeys.length !== 1) {
				throw new Error(
					`Nested relation "${relationName}" requires exactly one foreign key field.`,
				);
			}

			const foreignKeyField = fieldKeys[0];
			const referenceKey = relation.references?.[0] || "id";
			const relatedCrud = this.cms.api.collections[relation.collection];

			if (operations.connect) {
				if (Array.isArray(operations.connect)) {
					if (operations.connect.length !== 1) {
						throw new Error(
							`Nested relation "${relationName}" supports a single connect target.`,
						);
					}
					updatedFields[foreignKeyField] = operations.connect[0].id;
				} else {
					updatedFields[foreignKeyField] = operations.connect.id;
				}
			} else if (operations.create) {
				if (Array.isArray(operations.create)) {
					throw new Error(
						`Nested relation "${relationName}" supports a single create payload.`,
					);
				}
				const created = await relatedCrud.create(operations.create, {
					...context,
					db: tx,
				});
				updatedFields[foreignKeyField] = created?.[referenceKey] ?? created?.id;
			} else if (operations.connectOrCreate) {
				if (Array.isArray(operations.connectOrCreate)) {
					throw new Error(
						`Nested relation "${relationName}" supports a single connectOrCreate payload.`,
					);
				}

				const existing = await relatedCrud.findOne(
					{ where: operations.connectOrCreate.where },
					{ ...context, db: tx },
				);

				const target = existing
					? existing
					: await relatedCrud.create(operations.connectOrCreate.create, {
							...context,
							db: tx,
						});

				updatedFields[foreignKeyField] = target?.[referenceKey] ?? target?.id;
			}

			delete remainingRelations[relationName];
		}

		return {
			regularFields: updatedFields,
			nestedRelations: remainingRelations,
		};
	}

	/**
	 * Process nested relation operations (create, connect, connectOrCreate)
	 */
	private async processNestedRelations(
		parentRecord: any,
		nestedRelations: Record<string, any>,
		context: CRUDContext,
		tx: any,
	): Promise<void> {
		if (!this.cms || !this.state.relations) return;

		for (const [relationName, operations] of Object.entries(nestedRelations)) {
			const relation = this.state.relations[relationName];
			if (!relation) continue;

			// Handle BelongsTo (one) relations - skip nested operations
			if (
				relation.type === "one" &&
				relation.fields &&
				relation.fields.length > 0
			) {
			}

			// Handle HasMany (many) relations
			else if (relation.type === "many" && !relation.fields) {
				const reverseRelationName = relation.relationName;
				if (!reverseRelationName) continue;

				const relatedCrud = this.cms.api.collections[relation.collection];
				const reverseRelation =
					relatedCrud["~internalState"].relations?.[reverseRelationName];
				if (!reverseRelation?.fields || reverseRelation.fields.length === 0)
					continue;

				const foreignKeyField =
					this.resolveFieldKey(
						relatedCrud["~internalState"],
						reverseRelation.fields[0],
						relatedCrud["~internalRelatedTable"],
					) ?? reverseRelation.fields[0].name;
				const primaryKeyField = reverseRelation.references?.[0] || "id";

				if (operations.create) {
					const createInputs = Array.isArray(operations.create)
						? operations.create
						: [operations.create];

					for (const createInput of createInputs) {
						await relatedCrud.create(
							{
								...createInput,
								[foreignKeyField]: parentRecord[primaryKeyField],
							},
							{ ...context, db: tx },
						);
					}
				}

				if (operations.connect) {
					const connectInputs = Array.isArray(operations.connect)
						? operations.connect
						: [operations.connect];

					for (const connectInput of connectInputs) {
						await relatedCrud.updateById(
							{
								id: connectInput.id,
								data: { [foreignKeyField]: parentRecord[primaryKeyField] },
							},
							{ ...context, db: tx },
						);
					}
				}

				if (operations.connectOrCreate) {
					const connectOrCreateInputs = Array.isArray(
						operations.connectOrCreate,
					)
						? operations.connectOrCreate
						: [operations.connectOrCreate];

					for (const connectOrCreateInput of connectOrCreateInputs) {
						const existing = await relatedCrud.findOne(
							{ where: connectOrCreateInput.where },
							{ ...context, db: tx },
						);

						if (existing) {
							await relatedCrud.updateById(
								{
									id: existing.id,
									data: { [foreignKeyField]: parentRecord[primaryKeyField] },
								},
								{ ...context, db: tx },
							);
						} else {
							await relatedCrud.create(
								{
									...connectOrCreateInput.create,
									[foreignKeyField]: parentRecord[primaryKeyField],
								},
								{ ...context, db: tx },
							);
						}
					}
				}
			}

			// Handle ManyToMany relations
			else if (relation.type === "manyToMany" && relation.through) {
				const sourceField = relation.sourceField;
				const targetField = relation.targetField;
				const sourceKey = relation.sourceKey || "id";

				if (!sourceField || !targetField) continue;

				const junctionCrud = this.cms.api.collections[relation.through];
				const relatedCrud = this.cms.api.collections[relation.collection];

				if (operations.create) {
					const createInputs = Array.isArray(operations.create)
						? operations.create
						: [operations.create];

					for (const createInput of createInputs) {
						const relatedRecord = await relatedCrud.create(createInput, {
							...context,
							db: tx,
						});

						await junctionCrud.create(
							{
								[sourceField]: parentRecord[sourceKey],
								[targetField]: relatedRecord.id,
							},
							{ ...context, db: tx },
						);
					}
				}

				if (operations.connect) {
					const connectInputs = Array.isArray(operations.connect)
						? operations.connect
						: [operations.connect];

					for (const connectInput of connectInputs) {
						await junctionCrud.create(
							{
								[sourceField]: parentRecord[sourceKey],
								[targetField]: connectInput.id,
							},
							{ ...context, db: tx },
						);
					}
				}

				if (operations.connectOrCreate) {
					const connectOrCreateInputs = Array.isArray(
						operations.connectOrCreate,
					)
						? operations.connectOrCreate
						: [operations.connectOrCreate];

					for (const connectOrCreateInput of connectOrCreateInputs) {
						const existing = await relatedCrud.findOne(
							{ where: connectOrCreateInput.where },
							{ ...context, db: tx },
						);

						const targetId = existing
							? existing.id
							: (
									await relatedCrud.create(connectOrCreateInput.create, {
										...context,
										db: tx,
									})
								).id;

						await junctionCrud.create(
							{
								[sourceField]: parentRecord[sourceKey],
								[targetField]: targetId,
							},
							{ ...context, db: tx },
						);
					}
				}
			}
		}
	}

	/**
	 * Create create operation
	 */
	private createCreate() {
		return async (input: CreateInput, context: CRUDContext = {}) => {
			const db = this.getDb(context);

			// Enforce access control
			const canCreate = await this.enforceAccessControl(
				"create",
				context,
				null,
				input,
			);
			if (canCreate === false) {
				throw new Error("Access denied: create");
			}

			// Execute beforeCreate hooks
			await this.executeHooks(
				this.state.hooks?.beforeCreate,
				this.createHookContext({
					data: input,
					operation: "create",
					context,
					db,
				}),
			);

			// Execute beforeChange hooks
			await this.executeHooks(
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: input,
					operation: "create",
					context,
					db,
				}),
			);

			let changeEvent: any = null;
			const record = await db.transaction(async (tx: any) => {
				// Separate nested relation operations from regular fields
				let { regularFields, nestedRelations } =
					this.separateNestedRelations(input);

				({ regularFields, nestedRelations } =
					await this.applyBelongsToRelations(
						regularFields,
						nestedRelations,
						context,
						tx,
					));

				// Split localized vs non-localized fields
				const { localized, nonLocalized } =
					this.splitLocalizedFields(regularFields);

				// Insert main record
				const [record] = await tx
					.insert(this.table)
					.values(nonLocalized)
					.returning();

				// Insert localized fields if any
				if (
					this.i18nTable &&
					context.locale &&
					Object.keys(localized).length > 0
				) {
					await tx.insert(this.i18nTable).values({
						parentId: record.id,
						locale: context.locale,
						...localized,
					});
				}

				// Process nested relation operations (create, connect, connectOrCreate)
				await this.processNestedRelations(record, nestedRelations, context, tx);

				// Create version
				await this.createVersion(tx, record, "create", context);

				// Execute afterCreate hooks
				await this.executeHooks(
					this.state.hooks?.afterCreate,
					this.createHookContext({
						data: record,
						operation: "create",
						context,
						db: tx,
					}),
				);

				// Execute afterChange hooks
				await this.executeHooks(
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: record,
						operation: "create",
						context,
						db: tx,
					}),
				);

				// Index to search (outside transaction)
				await this.indexToSearch(record, context);

				changeEvent = await this.appendRealtimeChange(
					{
						operation: "create",
						recordId: record.id,
						payload: record as Record<string, unknown>,
					},
					context,
					tx,
				);

				return record;
			});

			await this.notifyRealtimeChange(changeEvent);
			return record;
		};
	}

	/**
	 * Create update operation
	 */
	private createUpdate() {
		return async (params: UpdateParams, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			const { id, data } = params;

			// Load existing record using core query builder
			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq((this.table as any).id, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw new Error(`Record not found: ${id}`);
			}

			// Enforce access control
			const canUpdate = await this.enforceAccessControl(
				"update",
				context,
				existing,
				data,
			);
			if (canUpdate === false) {
				throw new Error("Access denied: update");
			}
			if (typeof canUpdate === "object") {
				// Check if existing record matches access conditions
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw new Error("Access denied: update (conditions not met)");
				}
			}

			// Execute beforeUpdate hooks
			await this.executeHooks(
				this.state.hooks?.beforeUpdate,
				this.createHookContext({
					data,
					original: existing,
					operation: "update",
					context,
					db,
				}),
			);

			// Execute beforeChange hooks
			await this.executeHooks(
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data,
					original: existing,
					operation: "update",
					context,
					db,
				}),
			);

			let changeEvent: any = null;
			const updatedRecord = await db.transaction(async (tx: any) => {
				const { localized, nonLocalized } = this.splitLocalizedFields(data);

				// Update main table
				if (Object.keys(nonLocalized).length > 0) {
					await tx
						.update(this.table)
						.set({
							...nonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(eq((this.table as any).id, id));

					// Update ALL i18n titles because parent fields might have changed
				}

				// Upsert localized fields
				if (
					this.i18nTable &&
					context.locale &&
					Object.keys(localized).length > 0
				) {
					await tx
						.insert(this.i18nTable)
						.values({
							parentId: id,
							locale: context.locale,
							...localized,
						})
						.onConflictDoUpdate({
							target: [
								(this.i18nTable as any).parentId,
								(this.i18nTable as any).locale,
							],
							set: localized,
						});

					// Update _title for this locale
				}

				// Fetch updated record
				const updatedRows = await tx
					.select()
					.from(this.table)
					.where(eq((this.table as any).id, id))
					.limit(1);
				const updated = updatedRows[0];

				// Create version
				await this.createVersion(tx, updated, "update", context);

				// Execute afterUpdate hooks
				await this.executeHooks(
					this.state.hooks?.afterUpdate,
					this.createHookContext({
						data: updated,
						original: existing,
						operation: "update",
						context,
						db: tx,
					}),
				);

				// Execute afterChange hooks
				await this.executeHooks(
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: updated,
						original: existing,
						operation: "update",
						context,
						db: tx,
					}),
				);

				// Index to search (outside transaction)
				await this.indexToSearch(updated, context);

				changeEvent = await this.appendRealtimeChange(
					{
						operation: "update",
						recordId: updated.id,
						payload: updated as Record<string, unknown>,
					},
					context,
					tx,
				);

				return updated;
			});

			await this.notifyRealtimeChange(changeEvent);
			return updatedRecord;
		};
	}

	/**
	 * Create delete operation (supports soft delete)
	 */
	private createDelete() {
		return async (params: DeleteParams, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			const { id } = params;

			// Load existing record
			// Use select instead of query to avoid dependency on query builder structure which might not exist if collection not registered in db.query
			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq((this.table as any).id, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw new Error(`Record not found: ${id}`);
			}

			// Enforce access control
			const canDelete = await this.enforceAccessControl(
				"delete",
				context,
				existing,
				params,
			);
			if (canDelete === false) {
				throw new Error("Access denied: delete");
			}
			if (typeof canDelete === "object") {
				// Check if existing record matches access conditions
				const matchesConditions = await this.checkAccessConditions(
					canDelete,
					existing,
				);
				if (!matchesConditions) {
					throw new Error("Access denied: delete (conditions not met)");
				}
			}

			// Execute beforeDelete hooks
			await this.executeHooks(
				this.state.hooks?.beforeDelete,
				this.createHookContext({
					data: existing,
					original: existing,
					operation: "delete",
					context,
					db,
				}),
			);

			// Handle cascade operations BEFORE delete
			await this.handleCascadeDelete(id, existing, context);

			let changeEvent: any = null;
			// Use transaction for delete + version
			await db.transaction(async (tx: any) => {
				// Create version BEFORE delete
				await this.createVersion(tx, existing, "delete", context);

				// Soft delete or hard delete
				if (this.state.options.softDelete) {
					await tx
						.update(this.table)
						.set({ deletedAt: new Date() })
						.where(eq((this.table as any).id, id));
				} else {
					await tx.delete(this.table).where(eq((this.table as any).id, id));
				}

				changeEvent = await this.appendRealtimeChange(
					{
						operation: "delete",
						recordId: id,
					},
					context,
					tx,
				);
			});

			// Execute afterDelete hooks
			await this.executeHooks(
				this.state.hooks?.afterDelete,
				this.createHookContext({
					data: existing,
					original: existing,
					operation: "delete",
					context,
					db,
				}),
			);

			// Remove from search index
			await this.removeFromSearch(id, context);

			await this.notifyRealtimeChange(changeEvent);

			return { success: true };
		};
	}

	/**
	 * Restore soft-deleted record by ID
	 */
	private createRestore() {
		return async (params: RestoreParams, context: CRUDContext = {}) => {
			if (!this.state.options.softDelete) {
				throw new Error("Soft delete is not enabled for this collection");
			}

			const db = this.getDb(context);
			const { id } = params;

			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq((this.table as any).id, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw new Error(`Record not found: ${id}`);
			}

			const canUpdate = await this.enforceAccessControl(
				"update",
				context,
				existing,
				{ deletedAt: null },
			);
			if (canUpdate === false) {
				throw new Error("Access denied: update");
			}
			if (typeof canUpdate === "object") {
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw new Error("Access denied: update (conditions not met)");
				}
			}

			if (!existing.deletedAt) {
				return existing;
			}

			const updateFn = this.createUpdate();
			return await updateFn(
				{
					id,
					data: { deletedAt: null } as any,
				},
				context,
			);
		};
	}

	/**
	 * Create updateMany operation - smart batched updates
	 * 1. findMany to get all matching records (for hooks + access control)
	 * 2. Loop through beforeUpdate hooks
	 * 3. Single batched UPDATE WHERE query
	 * 4. Loop through afterUpdate hooks
	 */
	private createUpdateMany() {
		return async (
			params: { where: Where; data: UpdateParams["data"] },
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);
			const find = this.createFindMany();

			// 1. Find all matching records (for hooks and access control)
			const { docs: records } = await find({ where: params.where }, context);

			if (records.length === 0) {
				return [];
			}

			// 2. Loop through beforeUpdate + beforeChange hooks
			for (const record of records) {
				// Check access control per record
				const canUpdate = await this.enforceAccessControl(
					"update",
					context,
					record,
					params.data,
				);
				if (canUpdate === false) {
					throw new Error(`Access denied: update record ${record.id}`);
				}
				if (typeof canUpdate === "object") {
					const matchesConditions = await this.checkAccessConditions(
						canUpdate,
						record,
					);
					if (!matchesConditions) {
						throw new Error(
							`Access denied: update record ${record.id} (conditions not met)`,
						);
					}
				}

				// Execute beforeUpdate hooks
				await this.executeHooks(
					this.state.hooks?.beforeUpdate,
					this.createHookContext({
						data: params.data,
						original: record,
						operation: "update",
						context,
						db,
					}),
				);

				// Execute beforeChange hooks
				await this.executeHooks(
					this.state.hooks?.beforeChange,
					this.createHookContext({
						data: params.data,
						original: record,
						operation: "update",
						context,
						db,
					}),
				);
			}

			// 3. Batched UPDATE query
			let changeEvent: any = null;
			const updatedRecords = await db.transaction(async (tx: any) => {
				const { localized, nonLocalized } = this.splitLocalizedFields(
					params.data,
				);
				const recordIds = records.map((r: any) => r.id);

				// Update main table (batched)
				if (Object.keys(nonLocalized).length > 0) {
					await tx
						.update(this.table)
						.set({
							...nonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(inArray((this.table as any).id, recordIds));
				}

				// Update localized fields (batched per locale)
				if (
					this.i18nTable &&
					context.locale &&
					Object.keys(localized).length > 0
				) {
					for (const recordId of recordIds) {
						await tx
							.insert(this.i18nTable)
							.values({
								parentId: recordId,
								locale: context.locale,
								...localized,
							})
							.onConflictDoUpdate({
								target: [
									(this.i18nTable as any).parentId,
									(this.i18nTable as any).locale,
								],
								set: localized,
							});
					}
				}

				// Fetch updated records
				const updatedRows = await tx
					.select()
					.from(this.table)
					.where(inArray((this.table as any).id, recordIds));

				// Create versions for each record
				for (const updated of updatedRows) {
					await this.createVersion(tx, updated, "update", context);
				}

				// 4. Loop through afterUpdate + afterChange hooks
				for (let i = 0; i < updatedRows.length; i++) {
					const updated = updatedRows[i];
					const original = records[i];

					// Execute afterUpdate hooks
					await this.executeHooks(
						this.state.hooks?.afterUpdate,
						this.createHookContext({
							data: updated,
							original,
							operation: "update",
							context,
							db: tx,
						}),
					);

					// Execute afterChange hooks
					await this.executeHooks(
						this.state.hooks?.afterChange,
						this.createHookContext({
							data: updated,
							original,
							operation: "update",
							context,
							db: tx,
						}),
					);

					// Index to search
					await this.indexToSearch(updated, context);
				}

				changeEvent = await this.appendRealtimeChange(
					{
						operation: "bulk_update",
						payload: { count: updatedRows.length },
					},
					context,
					tx,
				);

				return updatedRows;
			});

			await this.notifyRealtimeChange(changeEvent);
			return updatedRecords;
		};
	}

	/**
	 * Create deleteMany operation - smart batched deletes
	 * 1. findMany to get all matching records (for hooks + access control)
	 * 2. Loop through beforeDelete hooks
	 * 3. Single batched DELETE WHERE query
	 * 4. Loop through afterDelete hooks
	 */
	private createDeleteMany() {
		return async (params: { where: Where }, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			const find = this.createFindMany();

			// 1. Find all matching records (for hooks and access control)
			const { docs: records } = await find({ where: params.where }, context);

			if (records.length === 0) {
				return { success: true, count: 0 };
			}

			// 2. Loop through beforeDelete hooks and access control
			for (const record of records) {
				// Check access control per record
				const canDelete = await this.enforceAccessControl(
					"delete",
					context,
					record,
					params,
				);
				if (canDelete === false) {
					throw new Error(`Access denied: delete record ${record.id}`);
				}
				if (typeof canDelete === "object") {
					const matchesConditions = await this.checkAccessConditions(
						canDelete,
						record,
					);
					if (!matchesConditions) {
						throw new Error(
							`Access denied: delete record ${record.id} (conditions not met)`,
						);
					}
				}

				// Execute beforeDelete hooks
				await this.executeHooks(
					this.state.hooks?.beforeDelete,
					this.createHookContext({
						data: record,
						original: record,
						operation: "delete",
						context,
						db,
					}),
				);

				// Handle cascade operations per record
				await this.handleCascadeDelete(record.id, record, context);
			}

			let changeEvent: any = null;
			// 3. Batched DELETE query
			await db.transaction(async (tx: any) => {
				const recordIds = records.map((r: any) => r.id);

				// Create versions BEFORE delete
				for (const record of records) {
					await this.createVersion(tx, record, "delete", context);
				}

				// Batched soft delete or hard delete
				if (this.state.options.softDelete) {
					await tx
						.update(this.table)
						.set({ deletedAt: new Date() })
						.where(inArray((this.table as any).id, recordIds));
				} else {
					await tx
						.delete(this.table)
						.where(inArray((this.table as any).id, recordIds));
				}

				changeEvent = await this.appendRealtimeChange(
					{
						operation: "bulk_delete",
						payload: { count: records.length },
					},
					context,
					tx,
				);
			});

			// 4. Loop through afterDelete hooks
			for (const record of records) {
				// Execute afterDelete hooks
				await this.executeHooks(
					this.state.hooks?.afterDelete,
					this.createHookContext({
						data: record,
						original: record,
						operation: "delete",
						context,
						db,
					}),
				);

				// Remove from search index
				await this.removeFromSearch(record.id, context);
			}

			await this.notifyRealtimeChange(changeEvent);

			return { success: true, count: records.length };
		};
	}

	/**
	 * Find versions of a record
	 */
	private createFindVersions() {
		return async (options: FindVersionsOptions, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			if (!this.versionsTable) return [];
			const normalized = this.normalizeContext(context);

			// Enforce read access
			const canRead = await this.enforceAccessControl(
				"read",
				normalized,
				null,
				options,
			);
			if (!canRead) throw new Error("Access denied: read versions");

			let query: any;

			if (this.i18nVersionsTable && normalized.locale) {
				// When we have i18n, use select-from-join pattern
				const selectObj = this.buildVersionsSelectObject(normalized);
				query = db
					.select(selectObj)
					.from(this.versionsTable)
					.$dynamic()
					.leftJoin(
						this.i18nVersionsTable,
						and(
							eq(
								(this.i18nVersionsTable as any).parentId,
								(this.versionsTable as any).id,
							),
							eq(
								(this.i18nVersionsTable as any).versionNumber,
								(this.versionsTable as any).versionNumber,
							),
							eq((this.i18nVersionsTable as any).locale, normalized.locale),
						),
					)
					.where(eq((this.versionsTable as any).id, options.id))
					.orderBy(sql`${(this.versionsTable as any).versionNumber} ASC`);
			} else {
				// Without i18n, simpler select
				query = db
					.select(this.buildVersionsSelectObject(normalized))
					.from(this.versionsTable)
					.where(eq((this.versionsTable as any).id, options.id))
					.orderBy(sql`${(this.versionsTable as any).versionNumber} ASC`);
			}

			if (options.limit) {
				query = query.limit(options.limit);
			}
			if (options.offset) {
				query = query.offset(options.offset);
			}

			return await query;
		};
	}

	/**
	 * Revert to a specific version
	 */
	private createRevertToVersion() {
		return async (options: RevertVersionOptions, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			if (!this.versionsTable) throw new Error("Versioning not enabled");
			const hasVersionId = typeof options.versionId === "string";
			const hasVersion = typeof options.version === "number";

			if (!hasVersionId && !hasVersion) {
				throw new Error("Version or versionId required");
			}

			const versionRows = await db
				.select()
				.from(this.versionsTable)
				.where(
					hasVersionId
						? and(
								eq((this.versionsTable as any).id, options.id),
								eq((this.versionsTable as any).versionId, options.versionId),
							)
						: and(
								eq((this.versionsTable as any).id, options.id),
								eq((this.versionsTable as any).versionNumber, options.version),
							),
				)
				.limit(1);
			const version = versionRows[0];

			if (!version) throw new Error("Version not found");

			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq((this.table as any).id, options.id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw new Error(`Record not found: ${options.id}`);
			}

			const nonLocalized: Record<string, any> = {};
			for (const [name] of Object.entries(this.state.fields)) {
				if (this.state.localized.includes(name as any)) continue;
				nonLocalized[name] = version[name];
			}
			if (this.state.options.softDelete) {
				nonLocalized.deletedAt = version.deletedAt ?? null;
			}

			const localizedForContext: Record<string, any> = {};
			if (this.i18nVersionsTable && normalized.locale) {
				const localeRows = await db
					.select()
					.from(this.i18nVersionsTable)
					.where(
						and(
							eq((this.i18nVersionsTable as any).parentId, options.id),
							eq(
								(this.i18nVersionsTable as any).versionNumber,
								version.versionNumber,
							),
							eq((this.i18nVersionsTable as any).locale, normalized.locale),
						),
					)
					.limit(1);
				const localeRow = localeRows[0];
				if (localeRow) {
					for (const fieldName of this.state.localized) {
						localizedForContext[fieldName as string] =
							localeRow[fieldName as string];
					}
				}
			}

			const restoreData = { ...nonLocalized, ...localizedForContext };

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				restoreData,
			);
			if (canUpdate === false) {
				throw new Error("Access denied: update");
			}
			if (typeof canUpdate === "object") {
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw new Error("Access denied: update (conditions not met)");
				}
			}

			await this.executeHooks(
				this.state.hooks?.beforeUpdate,
				this.createHookContext({
					data: restoreData,
					original: existing,
					operation: "update",
					context: normalized,
					db,
				}),
			);

			await this.executeHooks(
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: restoreData,
					original: existing,
					operation: "update",
					context: normalized,
					db,
				}),
			);

			return db.transaction(async (tx: any) => {
				if (Object.keys(nonLocalized).length > 0) {
					await tx
						.update(this.table)
						.set({
							...nonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(eq((this.table as any).id, options.id));
				}

				if (this.i18nTable && this.i18nVersionsTable) {
					await tx
						.delete(this.i18nTable)
						.where(eq((this.i18nTable as any).parentId, options.id));

					const localeRows = await tx
						.select()
						.from(this.i18nVersionsTable)
						.where(
							and(
								eq((this.i18nVersionsTable as any).parentId, options.id),
								eq(
									(this.i18nVersionsTable as any).versionNumber,
									version.versionNumber,
								),
							),
						);

					if (localeRows.length > 0) {
						const insertRows = localeRows.map((row: any) => {
							const {
								id: _id,
								parentId: _parentId,
								versionNumber: _versionNumber,
								locale,
								...localizedFields
							} = row;
							return {
								parentId: options.id,
								locale,
								...localizedFields,
							};
						});

						await tx.insert(this.i18nTable).values(insertRows);
					}
				}

				const updatedRows = await tx
					.select()
					.from(this.table)
					.where(eq((this.table as any).id, options.id))
					.limit(1);
				const updated = updatedRows[0];

				await this.createVersion(tx, updated, "update", normalized);

				await this.executeHooks(
					this.state.hooks?.afterUpdate,
					this.createHookContext({
						data: updated,
						original: existing,
						operation: "update",
						context: normalized,
						db: tx,
					}),
				);

				await this.executeHooks(
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: updated,
						original: existing,
						operation: "update",
						context: normalized,
						db: tx,
					}),
				);

				await this.indexToSearch(updated, normalized);

				return updated;
			});
		};
	}

	/**
	 * Create a new version of the record
	 */
	private async createVersion(
		tx: any,
		row: any,
		operation: "create" | "update" | "delete",
		context: CRUDContext,
	) {
		if (!this.versionsTable) return;

		// Get max version
		const maxVersionQuery = await tx
			.select({
				max: sql<number>`MAX(${(this.versionsTable as any).versionNumber})`,
			})
			.from(this.versionsTable)
			.where(eq((this.versionsTable as any).id, row.id));

		const currentVersion = maxVersionQuery[0]?.max || 0;
		const newVersion = Number(currentVersion) + 1;

		// Insert new version
		await tx.insert(this.versionsTable).values({
			...row,
			versionNumber: newVersion,
			versionOperation: operation,
			versionUserId: context.user?.id ? String(context.user.id) : null,
			versionCreatedAt: new Date(),
		});

		if (this.i18nVersionsTable && this.i18nTable) {
			const i18nRows = await tx
				.select()
				.from(this.i18nTable)
				.where(eq((this.i18nTable as any).parentId, row.id));

			if (i18nRows.length > 0) {
				const insertRows = i18nRows.map((i18nRow: any) => {
					const { id: _id, parentId: _parentId, ...rest } = i18nRow;
					return {
						parentId: row.id,
						versionNumber: newVersion,
						...rest,
					};
				});

				await tx.insert(this.i18nVersionsTable).values(insertRows);
			}
		}

		// Cleanup if max versions reached
		const options = this.state.options.versioning;
		if (typeof options === "object" && options.maxVersions) {
			// Find IDs to delete (all versions older than top N)
			const versionsToDelete = await tx
				.select({ versionNumber: (this.versionsTable as any).versionNumber })
				.from(this.versionsTable)
				.where(eq((this.versionsTable as any).id, row.id))
				.orderBy(sql`${(this.versionsTable as any).versionNumber} DESC`)
				.offset(options.maxVersions);

			if (versionsToDelete.length > 0) {
				const versionNumbers = versionsToDelete.map(
					(v: any) => v.versionNumber,
				);
				await tx
					.delete(this.versionsTable)
					.where(
						and(
							eq((this.versionsTable as any).id, row.id),
							inArray(
								(this.versionsTable as any).versionNumber,
								versionNumbers,
							),
						),
					);

				if (this.i18nVersionsTable) {
					await tx
						.delete(this.i18nVersionsTable)
						.where(
							and(
								eq((this.i18nVersionsTable as any).parentId, row.id),
								inArray(
									(this.i18nVersionsTable as any).versionNumber,
									versionNumbers,
								),
							),
						);
				}
			}
		}
	}

	/**
	 * Execute hooks (supports arrays)
	 * Passes full CMS instance and proper hook context
	 */
	private async executeHooks(
		hooks: HookFunction | HookFunction[] | undefined,
		ctx: HookContext,
	) {
		if (!hooks) return;

		const hookArray = Array.isArray(hooks) ? hooks : [hooks];
		for (const hook of hookArray) {
			await hook(ctx);
		}
	}

	/**
	 * Create hook context with full CMS access
	 */
	private createHookContext(params: {
		data: any;
		original?: any;
		operation: "create" | "update" | "delete" | "read";
		context: CRUDContext;
		db: any;
	}): HookContext {
		const normalized = this.normalizeContext(params.context);

		return {
			data: params.data,
			original: params.original,
			user: normalized.user,
			locale: normalized.locale,
			accessMode: normalized.accessMode,
			operation: params.operation,
			cms: this.cms, // Full CMS instance for type-safe access to services
			db: params.db,
			// Legacy compatibility
			input: params.data,
			row: params.data,
		};
	}

	/**
	 * Enforce access control
	 * Returns: boolean (allowed/denied) OR AccessWhere (query conditions)
	 */
	private async enforceAccessControl(
		operation: "read" | "create" | "update" | "delete",
		context: CRUDContext,
		row: any,
		input?: any,
	): Promise<boolean | AccessWhere> {
		const db = this.getDb(context);
		const normalized = this.normalizeContext(context);

		// System mode bypasses all access control
		if (normalized.accessMode === "system") return true;

		const accessRule = this.state.access?.[operation];
		if (accessRule === undefined) return true; // No access rule = allow

		// Boolean rule
		if (typeof accessRule === "boolean") {
			return accessRule;
		}

		// Role string rule
		if (typeof accessRule === "string") {
			return (normalized.user as any)?.role === accessRule;
		}

		// Function rule
		if (typeof accessRule === "function") {
			const result = await accessRule({
				user: normalized.user,
				row,
				input,
				db,
				context: normalized,
			});

			return result;
		}

		return true;
	}

	/**
	 * Check if a row matches access conditions
	 */
	private async checkAccessConditions(
		conditions: AccessWhere,
		row: any,
	): Promise<boolean> {
		// Simple implementation: check each condition
		for (const [key, value] of Object.entries(conditions)) {
			if (key === "AND") {
				// All conditions must match
				for (const cond of value as AccessWhere[]) {
					if (!(await this.checkAccessConditions(cond, row))) {
						return false;
					}
				}
			} else if (key === "OR") {
				// At least one condition must match
				let anyMatch = false;
				for (const cond of value as AccessWhere[]) {
					if (await this.checkAccessConditions(cond, row)) {
						anyMatch = true;
						break;
					}
				}
				if (!anyMatch) return false;
			} else if (key === "NOT") {
				// Condition must NOT match
				if (await this.checkAccessConditions(value as AccessWhere, row)) {
					return false;
				}
				// Simple field equality check
				if (row[key] !== value) {
					return false;
				}
			}
		}

		return true;
	}

	/**
	 * Merge user WHERE with access control WHERE
	 */
	private mergeWhere(
		userWhere?: Where,
		accessWhere?: boolean | AccessWhere,
	): Where | undefined {
		if (accessWhere === true || accessWhere === false || !accessWhere) {
			return userWhere;
		}

		// Merge access conditions with user conditions
		if (!userWhere) {
			return accessWhere as Where;
		}

		// Combine with AND
		return {
			AND: [userWhere, accessWhere as Where],
		};
	}

	/**
	 * Build relation WHERE clause from nested relation filters
	 */
	private buildRelationWhereClause(
		relation: RelationConfig,
		relationValue: any,
		parentTable: any,
		context?: CRUDContext,
	): SQL | undefined {
		if (!this.cms) return undefined;

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
				const existsClause = this.buildRelationExistsClause(
					relation,
					isWhere,
					parentTable,
					context,
				);
				if (existsClause) clauses.push(existsClause);
			}

			if (isNotWhere !== undefined) {
				const existsClause = this.buildRelationExistsClause(
					relation,
					isNotWhere,
					parentTable,
					context,
				);
				if (existsClause) clauses.push(not(existsClause));
			}
		} else if (relation.type === "many" || relation.type === "manyToMany") {
			const someWhere =
				relationFilter.some ?? (hasQuantifiers ? undefined : relationFilter);
			const noneWhere = relationFilter.none;
			const everyWhere = relationFilter.every;

			if (someWhere !== undefined) {
				const existsClause = this.buildRelationExistsClause(
					relation,
					someWhere,
					parentTable,
					context,
				);
				if (existsClause) clauses.push(existsClause);
			}

			if (noneWhere !== undefined) {
				const existsClause = this.buildRelationExistsClause(
					relation,
					noneWhere,
					parentTable,
					context,
				);
				if (existsClause) clauses.push(not(existsClause));
			}

			if (everyWhere !== undefined) {
				const negatedWhere = { NOT: everyWhere } as Where;
				const existsClause = this.buildRelationExistsClause(
					relation,
					negatedWhere,
					parentTable,
					context,
				);
				if (existsClause) clauses.push(not(existsClause));
			}
		}

		return clauses.length > 0 ? and(...clauses) : undefined;
	}

	private buildRelationExistsClause(
		relation: RelationConfig,
		relationWhere: Where | undefined,
		parentTable: any,
		context?: CRUDContext,
	): SQL | undefined {
		switch (relation.type) {
			case "one":
				return this.buildBelongsToExistsClause(
					relation,
					relationWhere,
					context,
				);
			case "many":
				return this.buildHasManyExistsClause(
					relation,
					relationWhere,
					parentTable,
					context,
				);
			case "manyToMany":
				return this.buildManyToManyExistsClause(
					relation,
					relationWhere,
					parentTable,
					context,
				);
			default:
				return undefined;
		}
	}

	private buildBelongsToExistsClause(
		relation: RelationConfig,
		relationWhere: Where | undefined,
		context?: CRUDContext,
	): SQL | undefined {
		if (!this.cms || !relation.fields || !relation.references?.length) {
			return undefined;
		}

		const relatedCrud = this.cms.api.collections[relation.collection];
		const relatedTable = relatedCrud["~internalRelatedTable"];
		const relatedState = relatedCrud["~internalState"];

		const joinConditions = relation.fields
			.map((sourceField, index) => {
				const targetFieldName = relation.references?.[index];
				const targetColumn = targetFieldName
					? (relatedTable as any)[targetFieldName]
					: undefined;
				return targetColumn ? eq(targetColumn, sourceField) : undefined;
			})
			.filter(Boolean) as SQL[];

		if (joinConditions.length === 0) return undefined;

		const whereConditions: SQL[] = [...joinConditions];

		if (relationWhere) {
			const nestedClause = this.buildWhereClause(
				relationWhere,
				false,
				relatedTable,
				context,
				relatedState,
				relatedCrud["~internalI18nTable"],
			);
			if (nestedClause) whereConditions.push(nestedClause);
		}

		if (relatedState.options?.softDelete) {
			whereConditions.push(sql`${(relatedTable as any).deletedAt} IS NULL`);
		}

		const db = this.getDb(context);
		const subquery = db
			.select({ one: sql`1` })
			.from(relatedTable)
			.where(and(...whereConditions));

		return sql`exists (${subquery})`;
	}

	private buildHasManyExistsClause(
		relation: RelationConfig,
		relationWhere: Where | undefined,
		parentTable: PgTable,
		context?: CRUDContext,
	): SQL | undefined {
		if (!this.cms || relation.fields) return undefined;

		const relatedCrud = this.cms.api.collections[relation.collection];
		const relatedTable = relatedCrud["~internalRelatedTable"];
		const relatedState = relatedCrud["~internalState"];
		const reverseRelationName = relation.relationName;
		const reverseRelation = reverseRelationName
			? relatedState.relations?.[reverseRelationName]
			: undefined;

		if (!reverseRelation?.fields || !reverseRelation.references?.length) {
			return undefined;
		}

		const joinConditions = reverseRelation.fields
			.map((foreignField: any, index: number) => {
				const parentFieldName = reverseRelation.references?.[index];
				const parentColumn = parentFieldName
					? (parentTable as any)[parentFieldName]
					: undefined;
				return parentColumn ? eq(foreignField, parentColumn) : undefined;
			})
			.filter(Boolean) as SQL[];

		if (joinConditions.length === 0) return undefined;

		const whereConditions: SQL[] = [...joinConditions];

		if (relationWhere) {
			const nestedClause = this.buildWhereClause(
				relationWhere,
				false,
				relatedTable,
				context,
				relatedState,
				relatedCrud["~internalI18nTable"],
			);
			if (nestedClause) whereConditions.push(nestedClause);
		}

		if (relatedState.options?.softDelete) {
			whereConditions.push(sql`${(relatedTable as any).deletedAt} IS NULL`);
		}

		const db = this.getDb(context);
		const subquery = db
			.select({ one: sql`1` })
			.from(relatedTable)
			.where(and(...whereConditions));

		return sql`exists (${subquery})`;
	}

	private buildManyToManyExistsClause(
		relation: RelationConfig,
		relationWhere: Where | undefined,
		parentTable: any,
		context?: CRUDContext,
	): SQL | undefined {
		if (!this.cms || !relation.through) return undefined;

		const relatedCrud = this.cms.api.collections[relation.collection];
		const junctionCrud = this.cms.api.collections[relation.through];
		const relatedTable = relatedCrud["~internalRelatedTable"];
		const junctionTable = junctionCrud["~internalRelatedTable"];
		const relatedState = relatedCrud["~internalState"];
		const junctionState = junctionCrud["~internalState"];

		const sourceKey = relation.sourceKey || "id";
		const targetKey = relation.targetKey || "id";
		const sourceField = relation.sourceField;
		const targetField = relation.targetField;

		const parentColumn = (parentTable as any)[sourceKey];
		const relatedColumn = (relatedTable as any)[targetKey];
		const junctionSourceColumn = sourceField
			? (junctionTable as any)[sourceField]
			: undefined;
		const junctionTargetColumn = targetField
			? (junctionTable as any)[targetField]
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
			const nestedClause = this.buildWhereClause(
				relationWhere,
				false,
				relatedTable,
				context,
				relatedState,
				relatedCrud["~internalI18nTable"],
			);
			if (nestedClause) whereConditions.push(nestedClause);
		}

		if (junctionState.options?.softDelete) {
			whereConditions.push(sql`${(junctionTable as any).deletedAt} IS NULL`);
		}

		if (relatedState.options?.softDelete) {
			whereConditions.push(sql`${(relatedTable as any).deletedAt} IS NULL`);
		}

		const db = this.getDb(context);
		const subquery = db
			.select({ one: sql`1` })
			.from(junctionTable)
			.innerJoin(relatedTable, eq(junctionTargetColumn, relatedColumn))
			.where(and(...whereConditions));

		return sql`exists (${subquery})`;
	}

	/**
	 * Build WHERE clause from WHERE object
	 */
	private buildWhereClause(
		where: Where,
		useI18n: boolean = false,
		customTable?: any,
		context?: CRUDContext,
		customState?: CollectionBuilderState,
		customI18nTable?: PgTable | null,
	): SQL | undefined {
		const conditions: SQL[] = [];
		const targetTable = customTable || this.table;
		const targetState = customState || this.state;
		const targetI18nTable = customI18nTable ?? this.i18nTable;

		for (const [key, value] of Object.entries(where)) {
			if (key === "AND" && Array.isArray(value)) {
				const subClauses = value
					.map((w) =>
						this.buildWhereClause(
							w,
							useI18n,
							targetTable,
							context,
							targetState,
							targetI18nTable,
						),
					)
					.filter(Boolean) as SQL[];
				if (subClauses.length > 0) {
					conditions.push(and(...subClauses)!);
				}
			} else if (key === "OR" && Array.isArray(value)) {
				const subClauses = value
					.map((w) =>
						this.buildWhereClause(
							w,
							useI18n,
							targetTable,
							context,
							targetState,
							targetI18nTable,
						),
					)
					.filter(Boolean) as SQL[];
				if (subClauses.length > 0) {
					conditions.push(or(...subClauses)!);
				}
			} else if (key === "NOT" && typeof value === "object") {
				const subClause = this.buildWhereClause(
					value as Where,
					useI18n,
					targetTable,
					context,
					targetState,
					targetI18nTable,
				);
				if (subClause) {
					conditions.push(not(subClause));
				}
			} else if (key === "RAW" && typeof value === "function") {
				conditions.push(value(targetTable));
			} else if (targetState.relations?.[key]) {
				const relation = targetState.relations[key] as RelationConfig;
				const relationClause = this.buildRelationWhereClause(
					relation,
					value,
					targetTable,
					context,
				);
				if (relationClause) {
					conditions.push(relationClause);
				}
			} else if (
				typeof value === "object" &&
				value !== null &&
				!Array.isArray(value)
			) {
				// Field operators
				let column = (targetTable as any)[key];
				if (
					key === "_title" &&
					useI18n &&
					targetI18nTable &&
					(targetI18nTable as any)._title
				) {
					column = (targetI18nTable as any)._title;
				}

				if (!column) continue;

				for (const [op, val] of Object.entries(value)) {
					const condition = this.buildOperatorCondition(column, op, val);
					if (condition) conditions.push(condition);
				}
			} else {
				// Simple equality
				let column = (targetTable as any)[key];
				if (
					key === "_title" &&
					useI18n &&
					targetI18nTable &&
					(targetI18nTable as any)._title
				) {
					column = (targetI18nTable as any)._title;
				}

				if (column) {
					if (value === null) {
						conditions.push(sql`${column} IS NULL`);
					} else {
						conditions.push(eq(column, value));
					}
				}
			}
		}

		return conditions.length > 0 ? and(...conditions) : undefined;
	}

	/**
	 * Build operator condition
	 */
	private buildOperatorCondition(
		column: any,
		op: string,
		value: any,
	): SQL | undefined {
		switch (op) {
			case "eq":
				return eq(column, value);
			case "ne":
				return sql`${column} != ${value}`;
			case "not":
				// Handle "not" operator: { field: { not: value } }
				if (value === null) {
					return sql`${column} IS NOT NULL`;
				}
				return sql`${column} != ${value}`;
			case "gt":
				return sql`${column} > ${value}`;
			case "gte":
				return sql`${column} >= ${value}`;
			case "lt":
				return sql`${column} < ${value}`;
			case "lte":
				return sql`${column} <= ${value}`;
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
	 * Build SELECT object for query
	 * Includes: regular fields, localized fields (with COALESCE), virtual fields, timestamps, _title
	 */
	private buildSelectObject(
		columns?: Columns,
		extras?: Extras,
		context?: CRUDContext,
	): any {
		const select: any = {
			id: (this.table as any).id,
		};

		const locale = context?.locale;
		const defaultLocale = context?.defaultLocale || "en";

		// Determine which fields to include based on columns option
		const includedFields = this.getIncludedFields(columns);

		// Regular and localized fields
		for (const [name, _column] of Object.entries(this.state.fields)) {
			// Skip if not in included fields
			if (!includedFields.has(name)) continue;

			// Localized field: COALESCE with i18n table (fallback to default locale)
			if (
				this.state.localized.includes(name as any) &&
				this.i18nTable &&
				locale
			) {
				const i18nTable = this.i18nTable as any;
				// COALESCE(current_locale_value, default_locale_value)
				select[name] = sql`COALESCE(
					${i18nTable[name]},
					(SELECT ${i18nTable[name]} FROM ${this.i18nTable}
					 WHERE ${i18nTable.parentId} = ${(this.table as any).id}
					 AND ${i18nTable.locale} = ${defaultLocale} LIMIT 1)
				)`;
			}
			// Regular field: direct column reference
			else {
				select[name] = (this.table as any)[name];
			}
		}

		// Virtual fields (computed SQL expressions)
		const virtuals = this.getVirtuals
			? this.getVirtuals(context)
			: this.state.virtuals;

		for (const [name, sqlExpr] of Object.entries(virtuals)) {
			if (!includedFields.has(name)) continue;
			select[name] = sqlExpr;
		}

		// _title field
		// _title field (pure virtual - computed from title expression)
		if (this.state.title && includedFields.has("_title")) {
			const titleExpr = this.getTitle
				? this.getTitle(context)
				: this.state.title;
			if (titleExpr) {
				select._title = titleExpr;
			} else {
				// Fallback to ID if no title expression
				select._title = (this.table as any).id;
			}
		}

		// Timestamps
		if (this.state.options.timestamps !== false) {
			if (includedFields.has("createdAt")) {
				select.createdAt = (this.table as any).createdAt;
			}
			if (includedFields.has("updatedAt")) {
				select.updatedAt = (this.table as any).updatedAt;
			}
		}

		// Soft delete
		if (this.state.options.softDelete && includedFields.has("deletedAt")) {
			select.deletedAt = (this.table as any).deletedAt;
		}

		// Extras (custom SQL fields)
		if (extras) {
			const extrasObj =
				typeof extras === "function" ? extras(this.table, { sql }) : extras;
			Object.assign(select, extrasObj);
		}

		return select;
	}

	/**
	 * Build SELECT object for versions query
	 * Includes: version metadata, regular fields, localized fields (with COALESCE), timestamps
	 */
	private buildVersionsSelectObject(context: CRUDContext): any {
		if (!this.versionsTable) return {};

		const versionsTable = this.versionsTable as any;
		const select: any = {
			versionId: versionsTable.versionId,
			id: versionsTable.id,
			versionNumber: versionsTable.versionNumber,
			versionOperation: versionsTable.versionOperation,
			versionUserId: versionsTable.versionUserId,
			versionCreatedAt: versionsTable.versionCreatedAt,
		};

		const locale = context.locale;
		const defaultLocale = context.defaultLocale || "en";

		for (const [name, _column] of Object.entries(this.state.fields)) {
			if (this.state.localized.includes(name as any)) {
				if (this.i18nVersionsTable && locale) {
					const i18nVersionsTable = this.i18nVersionsTable as any;
					select[name] = sql`COALESCE(
						${i18nVersionsTable[name]},
						(SELECT ${i18nVersionsTable[name]} FROM ${this.i18nVersionsTable}
						 WHERE ${i18nVersionsTable.parentId} = ${versionsTable.id}
						 AND ${i18nVersionsTable.versionNumber} = ${versionsTable.versionNumber}
						 AND ${i18nVersionsTable.locale} = ${defaultLocale} LIMIT 1)
					)`;
				}
				continue;
			}

			select[name] = versionsTable[name];
		}

		const versionVirtuals = this.getVirtualsForVersions
			? this.getVirtualsForVersions(context)
			: {};
		if (versionVirtuals) {
			for (const [name, sqlExpr] of Object.entries(versionVirtuals)) {
				select[name] = sqlExpr;
			}
		}

		if (this.state.title) {
			const titleExpr = this.getTitleForVersions
				? this.getTitleForVersions(context)
				: undefined;
			select._title = titleExpr || versionsTable.id;
		}

		// Note: versions table doesn't have timestamps or soft delete
		// Those are represented by versionCreatedAt in the versions table
		// Don't add these fields as they don't exist in versions table

		return select;
	}

	/**
	 * Get included fields based on columns option
	 * Two modes:
	 * 1. Inclusion mode: If any field is set to true, only include those fields
	 * 2. Omission mode: If all fields are false (or undefined), include all fields except false ones
	 */
	private getIncludedFields(columns?: Columns): Set<string> {
		const allFields = [
			...Object.keys(this.state.fields),
			...Object.keys(this.state.virtuals),
			"_title",
			"createdAt",
			"updatedAt",
			"deletedAt",
		];

		if (!columns) {
			// No columns specified - include all fields
			return new Set(allFields);
		}

		const included = new Set<string>();
		const hasTrueValues = Object.values(columns).some((v) => v === true);

		if (hasTrueValues) {
			// Inclusion mode: only include fields explicitly set to true
			for (const [key, value] of Object.entries(columns)) {
				if (value === true) {
					included.add(key);
				}
			}
		} else {
			// Omission mode: include all fields except those set to false
			for (const key of allFields) {
				if (columns[key] !== false) {
					included.add(key);
				}
			}
		}

		// Always include 'id'
		included.add("id");

		return included;
	}

	/**
	 * Build order by clauses
	 */
	private buildOrderByClauses(
		orderBy: OrderBy,
		useI18n: boolean = false,
	): SQL[] {
		if (typeof orderBy === "function") {
			return orderBy(this.table, {
				asc: (col: any) => sql`${col} ASC`,
				desc: (col: any) => sql`${col} DESC`,
			});
		}

		// Object syntax
		const clauses: SQL[] = [];
		for (const [field, direction] of Object.entries(orderBy)) {
			let column = (this.table as any)[field];
			if (
				field === "_title" &&
				useI18n &&
				this.i18nTable &&
				(this.i18nTable as any)._title
			) {
				column = (this.i18nTable as any)._title;
			}

			if (column) {
				clauses.push(
					direction === "desc" ? sql`${column} DESC` : sql`${column} ASC`,
				);
			}
		}

		return clauses;
	}

	private resolveFieldKey(
		state: CollectionBuilderState,
		column: any,
		table?: any,
	): string | undefined {
		if (typeof column === "string") return column;

		const columnName = column?.name;
		if (!columnName) return undefined;

		for (const [key, value] of Object.entries(state.fields)) {
			if ((value as any)?.name === columnName) return key;
		}

		if (table) {
			for (const [key, value] of Object.entries(table)) {
				if ((value as any)?.name === columnName) return key;
			}
		}

		return undefined;
	}

	/**
	 * Split localized and non-localized fields
	 */
	private splitLocalizedFields(input: any) {
		const localized: any = {};
		const nonLocalized: any = {};

		for (const [key, value] of Object.entries(input)) {
			if (this.state.localized.includes(key as any)) {
				localized[key] = value;
			} else {
				nonLocalized[key] = value;
			}
		}

		return { localized, nonLocalized };
	}

	/**
	 * Index record to search service
	 * Called after create/update operations
	 */
	private async indexToSearch(
		record: any,
		context: CRUDContext,
	): Promise<void> {
		// Skip if no searchable config or no CMS instance
		if (!this.state.searchable || !this.cms) return;

		// Skip if searchable.manual is true (user controls indexing via hooks)
		if (this.state.searchable.manual) return;

		// Skip if no search service available
		if (!this.cms.search) return;

		const normalized = this.normalizeContext(context);
		const locale = normalized.locale;

		// Extract title (required)
		let title: string = "";
		if (this.getTitle) {
			const _titleExpr = this.getTitle(context);
			// For indexing, we need the actual value, not SQL
			// If _titleExprs _title field, use it; otherwise extract from title expression
			if (record._title) {
				title = record._title;
			}
		} else {
			// Fallback to ID if no title expression
			title = record._title || record.id;
		}

		// Extract content (optional)
		let content: string | undefined;
		if (this.state.searchable.content) {
			content = this.state.searchable.content(record) || undefined;
		}

		// Extract metadata (optional)
		let metadata: Record<string, any> | undefined;
		if (this.state.searchable.metadata) {
			metadata = this.state.searchable.metadata(record);
		}

		// Generate embeddings (optional)
		let embedding: number[] | undefined;
		if (this.state.searchable.embeddings) {
			const searchableContext = {
				cms: this.cms,
				locale,
				defaultLocale: normalized.defaultLocale,
			};
			embedding = await this.state.searchable.embeddings(
				record,
				searchableContext,
			);
		}

		// Index to search
		await this.cms.search.index({
			collection: this.state.name,
			recordId: record.id,
			locale,
			title,
			content,
			metadata,
			embedding,
		});
	}

	private async appendRealtimeChange(
		params: {
			operation: "create" | "update" | "delete" | "bulk_update" | "bulk_delete";
			recordId?: string | null;
			payload?: Record<string, unknown>;
		},
		context: CRUDContext,
		db: any,
	) {
		if (!this.cms?.realtime) return null;
		const normalized = this.normalizeContext(context);

		return this.cms.realtime.appendChange(
			{
				resourceType: "collection",
				resource: this.state.name,
				operation: params.operation,
				recordId: params.recordId ?? null,
				locale: normalized.locale ?? null,
				payload: params.payload ?? {},
			},
			{ db },
		);
	}

	private async notifyRealtimeChange(change: unknown) {
		if (!change || !this.cms?.realtime) return;
		await this.cms.realtime.notify(change as any);
	}

	/**
	 * Remove record from search index
	 * Called after delete operations
	 */
	private async removeFromSearch(
		recordId: string,
		context: CRUDContext,
	): Promise<void> {
		// Skip if no searchable config or no CMS instance
		if (!this.state.searchable || !this.cms) return;

		// Skip if searchable.manual is true
		if (this.state.searchable.manual) return;

		// Skip if no search service available
		if (!this.cms.search) return;

		const normalized = this.normalizeContext(context);

		// Remove from search index (all locales if locale not specified)
		await this.cms.search.remove({
			collection: this.state.name,
			recordId,
			locale: normalized.locale, // Will remove all locales if undefined
		});
	}
}
