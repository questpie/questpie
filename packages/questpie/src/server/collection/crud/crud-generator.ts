import {
	and,
	asc,
	type Column,
	count,
	desc,
	eq,
	inArray,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias, type PgTable } from "drizzle-orm/pg-core";

import type {
	AccessWhere,
	CollectionBuilderState,
	HookContext,
	TransitionHookContext,
} from "#questpie/server/collection/builder/types.js";

/** Title expression for SQL queries - resolved column or SQL expression */
type TitleExpressionSQL = SQL | Column | null;

// Search/realtime integrations removed (Phase 3 — QUE-251).
// Side effects now come from core module global hooks.
import {
	buildLocalizedFieldRef,
	buildOrderByClauses,
	buildSelectObject,
	buildVersionsSelectObject,
	buildWhereClause,
} from "#questpie/server/collection/crud/query-builders/index.js";
import {
	applyBelongsToRelations,
	extractBelongsToConnectValues,
	handleCascadeDelete,
	processNestedRelations,
	separateNestedRelations,
} from "#questpie/server/collection/crud/relation-mutations/index.js";
import {
	resolveBelongsToRelation,
	resolveHasManyRelation,
	resolveHasManyWithAggregation,
	resolveManyToManyRelation,
} from "#questpie/server/collection/crud/relation-resolvers/index.js";
import {
	executeAccessRule,
	getRestrictedReadFields,
	matchesAccessConditions,
	mergeFieldAccessRules,
	mergeWhereWithAccess,
	PRECHECKED_READ_ACCESS,
	removeRestrictedReadFields,
	validateFieldsWriteAccess,
} from "#questpie/server/collection/crud/shared/access-control.js";
import { INHERIT_ACCESS } from "#questpie/server/collection/crud/shared/context.js";
import {
	extractLocalizedFieldNames,
	extractNestedLocalizationSchemas,
	type NestedLocalizationSchema,
} from "#questpie/server/collection/crud/shared/field-extraction.js";
import { getColumn } from "#questpie/server/collection/crud/shared/field-resolver.js";
import {
	executeGlobalCollectionHooks,
	executeGlobalCollectionTransitionHooks,
} from "#questpie/server/collection/crud/shared/global-hooks.js";
import {
	createHookContext,
	executeHooks,
	getCurrentTransaction,
	getDb,
	guardCrudMethods,
	isInTransaction,
	mergeI18nRows,
	normalizeContext,
	normalizeJsonbInput,
	resolveFieldKey,
	splitLocalizedFields,
	withTransaction,
} from "#questpie/server/collection/crud/shared/index.js";
import type {
	Columns,
	CRUD,
	CRUDContext,
	CreateInput,
	DeleteParams,
	Extras,
	FindManyOptions,
	FindOneOptionsBase,
	GroupedPaginatedResult,
	GroupByOptions,
	LockManyParams,
	FindVersionsOptions,
	OrderBy,
	PaginatedResult,
	RestoreParams,
	RevertVersionOptions,
	TransitionStageParams,
	UpdateParams,
	UploadFile,
	Where,
	With,
} from "#questpie/server/collection/crud/types.js";
import { createVersionRecord } from "#questpie/server/collection/crud/versioning/index.js";
import { extractAppServices } from "#questpie/server/config/app-context.js";
import {
	guardHookRecursion,
	runWithContext,
} from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import type { StorageVisibility } from "#questpie/server/config/types.js";
import { ApiError, parseDatabaseError } from "#questpie/server/errors/index.js";
import {
	applyFieldInputHooks,
	applyFieldOutputHooks,
} from "#questpie/server/fields/runtime.js";
import type { FieldAccess } from "#questpie/server/fields/types.js";
import {
	extractWorkflowFromVersioning,
	type ResolvedWorkflowConfig,
	resolveWorkflowConfig,
} from "#questpie/server/modules/core/workflow/config.js";

/**
 * True when a where clause constrains nothing but `id`.
 * Ids are immutable, so an id-only predicate that matched at pre-SELECT time
 * still matches any row that exists at lock time — no recheck query needed.
 */
function isIdOnlyWhere(where: Where | undefined): boolean {
	if (!where || typeof where !== "object") return false;
	const keys = Object.keys(where);
	return keys.length === 1 && keys[0] === "id";
}

export class CRUDGenerator<TState extends CollectionBuilderState> {
	private readonly workflowConfig: ResolvedWorkflowConfig | undefined;

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
		_getVirtuals?: (context: any) => TState["virtuals"],
		private getVirtualsWithAliases?: (
			context: any,
			i18nCurrentTable: PgTable | null,
			i18nFallbackTable: PgTable | null,
		) => TState["virtuals"],
		private getTitleExpression?: (context: any) => TitleExpressionSQL,
		_getVirtualsForVersions?: (context: any) => TState["virtuals"],
		private getVirtualsForVersionsWithAliases?: (
			context: any,
			i18nVersionsCurrentTable: PgTable | null,
			i18nVersionsFallbackTable: PgTable | null,
		) => TState["virtuals"],
		private getTitleExpressionForVersions?: (
			context: any,
		) => TitleExpressionSQL,
		_getRawTitleExpression?: (context: any) => TitleExpressionSQL,
		private app?: Questpie<any>,
	) {
		this.workflowConfig = resolveWorkflowConfig(
			extractWorkflowFromVersioning(this.state.options.versioning),
		);

		if (this.workflowConfig && !this.versionsTable) {
			throw new Error(
				`Collection "${this.state.name}" enables workflow but versioning is disabled. Enable options.versioning to use workflow stages.`,
			);
		}
	}

	/**
	 * Get localized field names.
	 * Uses field definitions (new API) or state.localized array (legacy API).
	 */
	private getLocalizedFieldNames(): string[] {
		// New API: field definitions with TState location
		if (this.state.fieldDefinitions) {
			return extractLocalizedFieldNames(this.state.fieldDefinitions);
		}
		// Legacy API: explicit localized array
		return (this.state.localized ?? []) as string[];
	}

	/**
	 * Check if collection has any localized fields.
	 */
	private hasLocalizedFieldsInternal(): boolean {
		return this.getLocalizedFieldNames().length > 0;
	}

	private getReadStage(
		options: FindManyOptions | FindOneOptionsBase,
		context: CRUDContext,
	): string | undefined {
		if (!this.workflowConfig) return undefined;

		const requested = options.stage ?? context.stage;
		const stage = requested ?? this.workflowConfig.initialStage;
		const exists = this.workflowConfig.stages.some(
			(item) => item.name === stage,
		);

		if (!exists) {
			throw ApiError.badRequest(
				`Unknown workflow stage "${stage}" for collection "${this.state.name}"`,
			);
		}

		return stage;
	}

	private getWriteStage(context: CRUDContext): string | undefined {
		if (!this.workflowConfig) return undefined;

		const stage = context.stage ?? this.workflowConfig.initialStage;
		const exists = this.workflowConfig.stages.some(
			(item) => item.name === stage,
		);

		if (!exists) {
			throw ApiError.badRequest(
				`Unknown workflow stage "${stage}" for collection "${this.state.name}"`,
			);
		}

		return stage;
	}

	private assertTransitionAllowed(fromStage: string, toStage: string): void {
		if (!this.workflowConfig || fromStage === toStage) {
			return;
		}

		const fromConfig = this.workflowConfig.stages.find(
			(item) => item.name === fromStage,
		);
		if (!fromConfig) {
			return;
		}

		if (fromConfig.transitions && !fromConfig.transitions.includes(toStage)) {
			throw ApiError.badRequest(
				`Transition from "${fromStage}" to "${toStage}" is not allowed for collection "${this.state.name}"`,
			);
		}
	}

	private async getCurrentWorkflowStage(
		db: any,
		recordId: string | number,
	): Promise<string> {
		if (!this.workflowConfig || !this.versionsTable) {
			return this.workflowConfig?.initialStage ?? "draft";
		}

		const stageColumn = getColumn(this.versionsTable, "versionStage");
		if (!stageColumn) {
			return this.workflowConfig.initialStage;
		}

		const idCol = getColumn(this.versionsTable, "id")!;
		const versionNumCol = getColumn(this.versionsTable, "versionNumber")!;

		const rows = await db
			.select({ stage: stageColumn })
			.from(this.versionsTable)
			.where(and(eq(idCol, recordId), sql`${stageColumn} IS NOT NULL`))
			.orderBy(sql`${versionNumCol} DESC`)
			.limit(1);

		return rows[0]?.stage ?? this.workflowConfig.initialStage;
	}

	private buildLatestStageSubquery(db: any, stage: string, aliasName: string) {
		if (!this.versionsTable) {
			throw ApiError.notImplemented("Versioning");
		}

		const vIdCol = getColumn(this.versionsTable, "id")!;
		const vNumCol = getColumn(this.versionsTable, "versionNumber")!;
		const vStageCol = getColumn(this.versionsTable, "versionStage")!;

		return db
			.select({
				id: vIdCol,
				maxVersionNumber: sql<number>`MAX(${vNumCol})`.as("max_version_number"),
			})
			.from(this.versionsTable)
			.where(eq(vStageCol, stage))
			.groupBy(vIdCol)
			.as(aliasName);
	}

	/**
	 * Generate CRUD operations
	 */
	generate(): CRUD {
		const find = this.wrapWithAppContext(this.createFind());
		const findOne = this.wrapWithAppContext(this.createFindOne());
		const updateMany = this.wrapWithAppContext(this.createUpdateMany());
		const updateBatch = this.wrapWithAppContext(this.createUpdateBatch());
		const deleteMany = this.wrapWithAppContext(this.createDeleteMany());
		const restoreById = this.wrapWithAppContext(this.createRestore());

		const crud: CRUD = {
			find: find as CRUD["find"],
			findOne,
			count: this.wrapWithAppContext(this.createCount()),
			lockMany: this.wrapWithAppContext(this.createLockMany()),
			create: this.wrapWithAppContext(this.createCreate()),
			updateById: this.wrapWithAppContext(this.createUpdate()),
			updateMany,
			// Deprecated alias of updateMany (removed in v4)
			update: updateMany,
			updateBatch,
			deleteById: this.wrapWithAppContext(this.createDelete()),
			deleteMany,
			// Deprecated alias of deleteMany (removed in v4)
			delete: deleteMany,
			restoreById,
			findVersions: this.wrapWithAppContext(this.createFindVersions()),
			revertToVersion: this.wrapWithAppContext(this.createRevertToVersion()),
			transitionStage: this.wrapWithAppContext(this.createTransitionStage()),
		};

		// Add upload methods if collection has upload config
		if (this.state.upload) {
			crud.upload = this.wrapWithAppContext(this.createUpload());
			crud.uploadMany = this.wrapWithAppContext(this.createUploadMany());
		}

		crud["~internalState"] = this.state;
		crud["~internalRelatedTable"] = this.table;
		crud["~internalI18nTable"] = this.i18nTable;

		// Fail loud on unknown method access (e.g. typos in untyped glue code)
		return guardCrudMethods(crud, this.state.name);
	}

	private getDb(context?: CRUDContext) {
		return getDb(this.db, context);
	}

	private createLockMany() {
		return async (
			params: LockManyParams,
			context: CRUDContext = {},
		): Promise<Array<string | number>> => {
			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);
			const currentTransaction = getCurrentTransaction();
			if (
				!isInTransaction() ||
				!currentTransaction ||
				db !== currentTransaction
			) {
				throw ApiError.badRequest(
					"lockMany requires the active QUESTPIE transaction in the CRUD context",
				);
			}

			const ids = [...new Set(params.ids)];
			if (ids.length > 100) {
				throw ApiError.badRequest("lockMany accepts at most 100 ids");
			}
			if (ids.length === 0) return [];

			const requestedWhere = { id: { in: ids } } as Where;
			const accessWhere = await this.enforceAccessControl(
				"read",
				normalized,
				null,
				{ where: requestedWhere },
			);
			if (accessWhere === false) {
				throw ApiError.forbidden({
					operation: "read",
					resource: this.state.name,
					reason: "User does not have permission to lock records",
				});
			}

			const whereClauses: SQL[] = [];
			const whereClause = this.buildWhereClause(
				this.mergeWhere(requestedWhere, accessWhere)!,
				false,
				this.table,
				normalized,
			);
			if (whereClause) whereClauses.push(whereClause);
			if (this.state.options.softDelete) {
				const deletedAtColumn = getColumn(this.table, "deletedAt");
				if (deletedAtColumn) whereClauses.push(sql`${deletedAtColumn} IS NULL`);
			}

			const idColumn = getColumn(this.table, "id")!;
			const lockedRows: Array<{ id: string | number }> =
				await currentTransaction
					.select({ id: idColumn })
					.from(this.table)
					.where(and(...whereClauses))
					.orderBy(asc(idColumn))
					.for("update");

			return lockedRows.map(({ id }) => id);
		};
	}

	/**
	 * Normalize context with defaults
	 * Delegates to shared normalizeContext utility
	 */
	private normalizeContext(
		context: CRUDContext = {},
	): Required<Pick<CRUDContext, "accessMode" | "locale" | "defaultLocale">> &
		CRUDContext {
		return normalizeContext(context);
	}

	private wrapWithAppContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		// Direct passthrough - context is passed explicitly through function arguments
		return fn;
	}

	private getFieldAccessRules(): Record<string, FieldAccess> | undefined {
		// Source field access from collection-level .access({ fields: {...} })
		const collectionAccess = this.state.access as
			| { fields?: Record<string, FieldAccess> }
			| undefined;
		return mergeFieldAccessRules(
			collectionAccess?.fields,
			this.state.fieldDefinitions,
		);
	}

	private async runFieldInputHooks(
		data: Record<string, unknown>,
		operation: "create" | "update",
		context: CRUDContext,
		db: any,
		originalDocument?: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		return applyFieldInputHooks({
			data,
			fieldDefinitions: this.state.fieldDefinitions,
			collectionName: this.state.name,
			operation,
			context,
			db,
			originalDocument,
		});
	}

	private async runFieldOutputHooks(
		data: Record<string, unknown>,
		operation: "create" | "read" | "update",
		context: CRUDContext,
		db: any,
		originalDocument?: Record<string, unknown>,
	): Promise<void> {
		await applyFieldOutputHooks({
			data,
			fieldDefinitions: this.state.fieldDefinitions,
			collectionName: this.state.name,
			operation,
			context,
			db,
			originalDocument,
		});
	}

	private normalizeGroupBy(
		groupBy: FindManyOptions["groupBy"] | undefined,
	): (GroupByOptions & { order: "asc" | "desc" }) | undefined {
		if (!groupBy) return undefined;
		if (typeof groupBy === "string") return { field: groupBy, order: "asc" };
		if (!groupBy.field) return undefined;
		return {
			field: groupBy.field,
			order: groupBy.order === "desc" ? "desc" : "asc",
		};
	}

	private getGroupKey(value: unknown): string {
		return value === null || value === undefined ? "__empty" : String(value);
	}

	/**
	 * Internal find execution - shared logic for find and findOne
	 * Reduces code duplication between the two methods
	 *
	 * @param options - Query options (FindManyOptions or FindOneOptions)
	 * @param context - CRUD context
	 * @param mode - 'many' for paginated results, 'one' for single result
	 */
	private async _executeFind<T>(
		options: FindManyOptions | FindOneOptionsBase,
		context: CRUDContext,
		mode: "many" | "one",
		findOptions?: { skipOutputHooks?: boolean },
	): Promise<PaginatedResult<T> | GroupedPaginatedResult<T> | T | null> {
		// Normalize context FIRST to ensure locale defaults are applied
		const normalized = this.normalizeContext({
			...context,
			stage: options.stage ?? context.stage,
		});
		const db = this.getDb(normalized);

		// Run entire read operation within request-scoped context
		// This enables implicit getContext<TApp>() calls in hooks (e.g., afterRead prefetch)
		const _hookDepth = guardHookRecursion();
		return runWithContext(
			{
				app: this.app,
				session: normalized.session,
				db,
				locale: normalized.locale,
				accessMode: normalized.accessMode,
				stage: normalized.stage,
				"~contextExtensions": normalized["~contextExtensions"],
				_hookDepth,
			},
			async () => {
				// Execute beforeOperation hook
				await this.executeHooks(
					this.state.hooks?.beforeOperation,
					this.createHookContext({
						data: options,
						operation: "read",
						context: normalized,
						db,
					}),
				);

				// Enforce access control. Upload relations populate through the
				// PARENT row's read decision: the relation dispatcher stamps nested
				// options with an internal symbol (never user input — JSON cannot
				// carry symbols), which skips the collection-level read check while
				// field-level read filtering below stays active.
				const inheritAccess =
					(options as Record<PropertyKey, unknown>)[INHERIT_ACCESS] === true;
				const precheckedAccess = (options as Record<PropertyKey, unknown>)[
					PRECHECKED_READ_ACCESS
				] as AccessWhere | true | undefined;
				const accessWhere = inheritAccess
					? true
					: (precheckedAccess ??
						(await this.enforceAccessControl(
							"read",
							normalized,
							null,
							options,
						)));

				// Access explicitly denied
				if (accessWhere === false) {
					throw ApiError.forbidden({
						operation: "read",
						resource: this.state.name,
						reason: "User does not have permission to read records",
					});
				}

				// Execute beforeRead hooks (read doesn't modify data)
				if (this.state.hooks?.beforeRead) {
					await this.executeHooks(
						this.state.hooks.beforeRead,
						this.createHookContext({
							data: options,
							operation: "read",
							context: normalized,
							db,
						}),
					);
				}

				const mergedWhere = this.mergeWhere(options.where, accessWhere);
				const includeDeleted = options.includeDeleted === true;
				const readStage = this.getReadStage(options, normalized);
				const useStageVersions =
					!!this.workflowConfig &&
					!!readStage &&
					readStage !== this.workflowConfig.initialStage;
				const groupByOptions =
					mode === "many"
						? this.normalizeGroupBy((options as FindManyOptions).groupBy)
						: undefined;

				if (groupByOptions && useStageVersions) {
					throw ApiError.badRequest(
						"Grouped find is not supported for workflow stage reads yet",
					);
				}

				// Get total count only for 'many' mode (pagination)
				let totalDocs = 0;
				if (mode === "many") {
					if (useStageVersions && this.versionsTable) {
						const latestStageSubquery = this.buildLatestStageSubquery(
							db,
							readStage,
							"latest_stage_count",
						);

						let countQuery = db
							.select({ count: count() })
							.from(this.versionsTable)
							.innerJoin(
								latestStageSubquery,
								and(
									eq(
										getColumn(this.versionsTable, "id")!,
										latestStageSubquery.id,
									),
									eq(
										getColumn(this.versionsTable, "versionNumber")!,
										latestStageSubquery.maxVersionNumber,
									),
								),
							);

						const countWhereClauses: SQL[] = [];
						if (mergedWhere) {
							const whereClause = this.buildWhereClause(
								mergedWhere,
								false,
								this.versionsTable,
								normalized,
							);
							if (whereClause) {
								countWhereClauses.push(whereClause);
							}
						}

						if (this.state.options.softDelete && !includeDeleted) {
							const deletedAtColumn = getColumn(
								this.versionsTable,
								"deletedAt",
							);
							if (deletedAtColumn) {
								countWhereClauses.push(sql`${deletedAtColumn} IS NULL`);
							}
						}

						if (!includeDeleted) {
							const versionOpColumn = getColumn(
								this.versionsTable,
								"versionOperation",
							);
							if (versionOpColumn) {
								countWhereClauses.push(sql`${versionOpColumn} != 'delete'`);
							}
						}

						if (countWhereClauses.length > 0) {
							countQuery = countQuery.where(and(...countWhereClauses));
						}

						const countRows = await countQuery;
						totalDocs = countRows[0]?.count ?? 0;
					} else {
						const countFn = this.createCount();
						totalDocs = await countFn(
							{ where: mergedWhere, includeDeleted },
							{ ...normalized, accessMode: "system" },
						);
					}
				}

				const readTable = useStageVersions
					? (this.versionsTable as PgTable)
					: this.table;
				const i18nSourceTable = useStageVersions
					? this.i18nVersionsTable
					: this.i18nTable;

				// Determine if we are using i18n (i18n source table exists = entity has localized fields)
				const useI18n = !!i18nSourceTable;
				const needsFallback =
					useI18n &&
					normalized.localeFallback !== false &&
					normalized.locale !== normalized.defaultLocale;

				// Create aliased i18n tables for current and fallback locales
				const i18nCurrentTable = useI18n
					? alias(
							i18nSourceTable!,
							useStageVersions ? "i18n_v_current" : "i18n_current",
						)
					: null;
				const i18nFallbackTable = needsFallback
					? alias(
							i18nSourceTable!,
							useStageVersions ? "i18n_v_fallback" : "i18n_fallback",
						)
					: null;

				// Build SELECT object with aliased i18n tables
				const selectObj = this.buildSelectObject(
					options.columns ?? (options as { select?: Columns }).select,
					options.extras,
					normalized,
					i18nCurrentTable,
					i18nFallbackTable,
					readTable,
					useStageVersions,
				);

				// Start building query
				let query: any;
				if (useStageVersions) {
					const latestStageSubquery = this.buildLatestStageSubquery(
						db,
						readStage,
						"latest_stage_versions",
					);
					query = db
						.select(selectObj)
						.from(readTable)
						.innerJoin(
							latestStageSubquery,
							and(
								eq(getColumn(readTable, "id")!, latestStageSubquery.id),
								eq(
									getColumn(readTable, "versionNumber")!,
									latestStageSubquery.maxVersionNumber,
								),
							),
						);
				} else {
					query = db.select(selectObj).from(readTable);
				}

				// Add i18n joins if locale provided and localized fields exist
				if (useI18n && i18nCurrentTable) {
					if (useStageVersions) {
						query = query.leftJoin(
							i18nCurrentTable,
							and(
								eq(
									getColumn(i18nCurrentTable, "parentId")!,
									getColumn(readTable, "id")!,
								),
								eq(
									getColumn(i18nCurrentTable, "versionNumber")!,
									getColumn(readTable, "versionNumber")!,
								),
								eq(getColumn(i18nCurrentTable, "locale")!, normalized.locale!),
							),
						);

						if (needsFallback && i18nFallbackTable) {
							query = query.leftJoin(
								i18nFallbackTable,
								and(
									eq(
										getColumn(i18nFallbackTable, "parentId")!,
										getColumn(readTable, "id")!,
									),
									eq(
										getColumn(i18nFallbackTable, "versionNumber")!,
										getColumn(readTable, "versionNumber")!,
									),
									eq(
										getColumn(i18nFallbackTable, "locale")!,
										normalized.defaultLocale!,
									),
								),
							);
						}
					} else {
						query = query.leftJoin(
							i18nCurrentTable,
							and(
								eq(
									getColumn(i18nCurrentTable, "parentId")!,
									getColumn(readTable, "id")!,
								),
								eq(getColumn(i18nCurrentTable, "locale")!, normalized.locale!),
							),
						);

						if (needsFallback && i18nFallbackTable) {
							query = query.leftJoin(
								i18nFallbackTable,
								and(
									eq(
										getColumn(i18nFallbackTable, "parentId")!,
										getColumn(readTable, "id")!,
									),
									eq(
										getColumn(i18nFallbackTable, "locale")!,
										normalized.defaultLocale!,
									),
								),
							);
						}
					}
				}

				// WHERE clause with soft delete filter
				const whereClauses: SQL[] = [];

				if (mergedWhere) {
					const whereClause = this.buildWhereClause(
						mergedWhere,
						useI18n,
						readTable,
						normalized,
						undefined,
						i18nCurrentTable,
						i18nFallbackTable,
					);
					if (whereClause) {
						whereClauses.push(whereClause);
					}
				}

				// Soft delete filter
				if (this.state.options.softDelete && !includeDeleted) {
					const deletedAtColumn = getColumn(readTable, "deletedAt");
					if (deletedAtColumn) {
						const softDeleteFilter = sql`${deletedAtColumn} IS NULL`;
						whereClauses.push(softDeleteFilter);
					}
				}

				if (useStageVersions && !includeDeleted) {
					const versionOperationColumn = getColumn(
						readTable,
						"versionOperation",
					);
					if (versionOperationColumn) {
						whereClauses.push(sql`${versionOperationColumn} != 'delete'`);
					}
				}

				// Search filter by _title (for relation pickers, etc.) - only for 'many' mode
				if (mode === "many" && (options as FindManyOptions).search) {
					const searchTerm = (options as FindManyOptions).search;
					// Get the title expression using aliased tables
					let titleExpr: unknown = null;

					if (this.state.title) {
						// If title is a localized field, use buildLocalizedFieldRef
						const localizedFieldNames = this.getLocalizedFieldNames();
						if (
							localizedFieldNames.includes(this.state.title) &&
							i18nCurrentTable
						) {
							titleExpr = buildLocalizedFieldRef(this.state.title, {
								table: readTable,
								state: this.state,
								i18nCurrentTable,
								i18nFallbackTable,
								useI18n,
							});
						}
						// If title is a regular field
						else if (this.state.title in this.state.fields) {
							titleExpr = getColumn(readTable, this.state.title);
						}
						// If title is a virtual field, get from virtuals with aliased tables
						else {
							const virtualGetter = useStageVersions
								? this.getVirtualsForVersionsWithAliases
								: this.getVirtualsWithAliases;
							const virtuals = virtualGetter
								? virtualGetter(normalized, i18nCurrentTable, i18nFallbackTable)
								: undefined;
							if (virtuals && this.state.title in virtuals) {
								titleExpr = (virtuals as Record<string, unknown>)[
									this.state.title
								];
							}
						}
					}

					titleExpr = titleExpr || getColumn(readTable, "id");
					// Case-insensitive search using ILIKE
					const searchFilter = sql`${titleExpr}::text ILIKE ${`%${searchTerm}%`}`;
					whereClauses.push(searchFilter);
				}

				let groupRows: Array<{ value: unknown; count: number }> | undefined;
				let totalGroups: number | undefined;

				if (groupByOptions) {
					const column = getColumn(readTable, groupByOptions.field);
					if (!column) {
						throw ApiError.badRequest(
							`Cannot group ${this.state.name} by unknown field "${groupByOptions.field}"`,
						);
					}

					let totalGroupsQuery = db
						.select({ count: sql<number>`count(distinct ${column})::int` })
						.from(readTable);
					let groupsQuery = db
						.select({ value: column, count: count() })
						.from(readTable);

					if (useI18n && i18nCurrentTable) {
						totalGroupsQuery = totalGroupsQuery.leftJoin(
							i18nCurrentTable,
							and(
								eq(
									getColumn(i18nCurrentTable, "parentId")!,
									getColumn(readTable, "id")!,
								),
								eq(getColumn(i18nCurrentTable, "locale")!, normalized.locale!),
							),
						);
						groupsQuery = groupsQuery.leftJoin(
							i18nCurrentTable,
							and(
								eq(
									getColumn(i18nCurrentTable, "parentId")!,
									getColumn(readTable, "id")!,
								),
								eq(getColumn(i18nCurrentTable, "locale")!, normalized.locale!),
							),
						);

						if (needsFallback && i18nFallbackTable) {
							totalGroupsQuery = totalGroupsQuery.leftJoin(
								i18nFallbackTable,
								and(
									eq(
										getColumn(i18nFallbackTable, "parentId")!,
										getColumn(readTable, "id")!,
									),
									eq(
										getColumn(i18nFallbackTable, "locale")!,
										normalized.defaultLocale!,
									),
								),
							);
							groupsQuery = groupsQuery.leftJoin(
								i18nFallbackTable,
								and(
									eq(
										getColumn(i18nFallbackTable, "parentId")!,
										getColumn(readTable, "id")!,
									),
									eq(
										getColumn(i18nFallbackTable, "locale")!,
										normalized.defaultLocale!,
									),
								),
							);
						}
					}

					if (whereClauses.length > 0) {
						totalGroupsQuery = totalGroupsQuery.where(and(...whereClauses));
						groupsQuery = groupsQuery.where(and(...whereClauses));
					}

					const manyOptions = options as FindManyOptions;
					const groupLimit = manyOptions.limit ?? totalDocs;
					const groupOffset = manyOptions.offset ?? 0;
					const totalGroupRows = await totalGroupsQuery;
					totalGroups = totalGroupRows[0]?.count ?? 0;
					groupsQuery = groupsQuery
						.groupBy(column)
						.orderBy(
							groupByOptions.order === "desc" ? desc(column) : asc(column),
						);
					if (groupLimit !== undefined) {
						groupsQuery = groupsQuery.limit(groupLimit);
					}
					if (groupOffset !== undefined) {
						groupsQuery = groupsQuery.offset(groupOffset);
					}

					const selectedGroupRows = await groupsQuery;
					groupRows = selectedGroupRows;
					const groupValues = selectedGroupRows.map(
						(row: { value: unknown }) => row.value,
					);
					if (groupValues.length === 0) {
						whereClauses.push(sql`1 = 0`);
					} else {
						whereClauses.push(inArray(column, groupValues as any[]));
					}
				}

				if (whereClauses.length > 0) {
					query = query.where(and(...whereClauses));
				}

				// ORDER BY
				// Drizzle's .orderBy(...) REPLACES previous clauses (assignment, not
				// append), so multi-field ordering must go through a single variadic call.
				if (options.orderBy) {
					const orderClauses = this.buildOrderByClauses(
						options.orderBy,
						useI18n,
						i18nCurrentTable,
						i18nFallbackTable,
						readTable,
					);
					if (orderClauses.length > 0) {
						query = query.orderBy(...orderClauses);
					}
				}

				// LIMIT - for 'one' mode always 1, for 'many' use options
				if (mode === "one") {
					query = query.limit(1);
				} else {
					const manyOptions = options as FindManyOptions;
					if (!groupByOptions && manyOptions.limit !== undefined) {
						query = query.limit(manyOptions.limit);
					}
					if (!groupByOptions && manyOptions.offset !== undefined) {
						query = query.offset(manyOptions.offset);
					}
				}

				// Execute query
				let rows = await query;

				// Application-side i18n merge: replace prefixed columns with final values
				// Handles both flat localized fields and nested localized JSONB fields (via _localized column)
				const hasLocalized = this.hasLocalizedFieldsInternal();
				if (useI18n && rows.length > 0 && hasLocalized) {
					rows = mergeI18nRows(rows, {
						localizedFields: this.getLocalizedFieldNames(),
						hasFallback: needsFallback,
					});
				}

				// Handle relations
				if (rows.length > 0 && options.with && this.app) {
					await this.resolveRelations(rows, options.with, normalized);
				}

				// Filter fields and run output hooks in parallel per row.
				// `skipOutputHooks` is set by `_executeUpdate`'s in-tx refetch to
				// avoid recursing into other collections (e.g. blocks prefetch)
				// while a tx is open — those calls would inherit `db: tx` and
				// serialize through the open tx connection, deadlocking under
				// parallel load. Output hooks + afterRead are re-run by the
				// caller after the tx commits.
				await Promise.all(
					rows.map(async (row: any) => {
						await this.filterFieldsForRead(row, normalized);
						if (!findOptions?.skipOutputHooks) {
							await this.runFieldOutputHooks(row, "read", normalized, db);
						}
					}),
				);

				// Execute afterRead hooks in parallel per row
				if (this.state.hooks?.afterRead && !findOptions?.skipOutputHooks) {
					await Promise.all(
						rows.map((row: any) =>
							this.executeHooks(
								this.state.hooks.afterRead,
								this.createHookContext({
									data: row,
									operation: "read",
									context: normalized,
									db,
								}),
							),
						),
					);
				}

				// Return based on mode
				if (mode === "one") {
					return (rows[0] as T) || null;
				}

				// Construct paginated result for 'many' mode
				const manyOptions = options as FindManyOptions;
				const paginatedTotal = groupByOptions ? (totalGroups ?? 0) : totalDocs;
				const limit = manyOptions.limit ?? paginatedTotal;
				const totalPages = limit > 0 ? Math.ceil(paginatedTotal / limit) : 1;
				const offset = manyOptions.offset ?? 0;
				const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
				const pagingCounter = (page - 1) * limit + 1;
				const hasPrevPage = page > 1;
				const hasNextPage = page < totalPages;
				const prevPage = hasPrevPage ? page - 1 : null;
				const nextPage = hasNextPage ? page + 1 : null;
				const baseResult = {
					docs: rows as T[],
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

				if (!groupByOptions) return baseResult;

				return {
					...baseResult,
					groupBy: {
						field: groupByOptions.field,
						order: groupByOptions.order,
					},
					groups: (groupRows ?? []).map((group) => ({
						key: this.getGroupKey(group.value),
						value: group.value,
						count: group.count,
						docs: (rows as T[]).filter(
							(row: any) =>
								this.getGroupKey(row[groupByOptions.field]) ===
								this.getGroupKey(group.value),
						),
					})),
					totalGroups: totalGroups ?? 0,
				};
			},
		);
	}

	/**
	 * Create find operation - returns paginated results
	 */
	private createFind() {
		return async (
			options: FindManyOptions = {},
			context: CRUDContext = {},
		): Promise<PaginatedResult<any> | GroupedPaginatedResult<any>> => {
			return this._executeFind(options, context, "many") as Promise<
				PaginatedResult<any> | GroupedPaginatedResult<any>
			>;
		};
	}

	/**
	 * Create findOne operation - returns single record or null
	 */
	private createFindOne() {
		return async (
			options: FindOneOptionsBase = {},
			context: CRUDContext = {},
		): Promise<any | null> => {
			return this._executeFind(options, context, "one") as Promise<any | null>;
		};
	}

	/**
	 * Resolve relations recursively using extracted utilities
	 */
	private async resolveRelations(
		rows: any[],
		withConfig: With,
		context: CRUDContext,
	) {
		if (!rows.length || !withConfig || !this.app) return;
		const db = this.getDb(context);
		const typedRows = rows as Array<Record<string, any>>;
		const relationOptionKeys = new Set([
			"columns",
			"where",
			"orderBy",
			"limit",
			"offset",
			"with",
			"_aggregate",
			"_count",
		]);

		for (const [relationName, relationOptions] of Object.entries(withConfig)) {
			if (!relationOptions) continue;

			const relation = this.state.relations?.[relationName];
			if (!relation) continue;

			const relatedCrud = this.app.collections[
				relation.collection
			] as unknown as CRUD;

			// Parse nested options
			let nestedOptions: Record<string, any> = {};
			if (relationOptions === true) {
				nestedOptions = {};
			} else if (
				typeof relationOptions === "object" &&
				relationOptions !== null &&
				!Array.isArray(relationOptions)
			) {
				const hasQueryKey = Object.keys(relationOptions).some((key) =>
					relationOptionKeys.has(key),
				);
				nestedOptions = hasQueryKey
					? { ...(relationOptions as Record<string, any>) }
					: { with: relationOptions };
			}

			// Upload relations (f.upload) populate through the parent row's read
			// decision — the parent's access already authorized this content.
			// Field-level read rules on the target still apply. The symbol cannot
			// be injected via HTTP `with` input (JSON cannot carry symbols).
			if (relation.inheritAccess) {
				(nestedOptions as Record<PropertyKey, unknown>)[INHERIT_ACCESS] = true;
			}

			const hasFieldConfig =
				(relation.fields && relation.fields.length > 0) ||
				typeof relation.field === "string";

			// BelongsTo relation (FK on this table)
			if (hasFieldConfig) {
				await resolveBelongsToRelation({
					rows: typedRows,
					relationName,
					relation,
					relatedCrud,
					nestedOptions,
					context,
					resolveFieldKey: this.resolveFieldKey,
					sourceState: this.state,
					sourceTable: this.table,
				});
			}
			// HasMany relation (FK on related table)
			else if (relation.type === "many" && !relation.fields) {
				if (nestedOptions._count || nestedOptions._aggregate) {
					await resolveHasManyWithAggregation({
						rows: typedRows,
						relationName,
						relation,
						relatedCrud,
						nestedOptions,
						context,
						db,
						resolveFieldKey: this.resolveFieldKey,
						buildWhereClause,
						app: this.app,
					});
				} else {
					await resolveHasManyRelation({
						rows: typedRows,
						relationName,
						relation,
						relatedCrud,
						nestedOptions,
						context,
						db,
						resolveFieldKey: this.resolveFieldKey,
						buildWhereClause,
						app: this.app,
					});
				}
			}
			// ManyToMany relation (through junction table)
			else if (relation.type === "manyToMany" && relation.through) {
				const junctionCrud = this.app.collections[
					relation.through
				] as unknown as CRUD;
				await resolveManyToManyRelation({
					rows: typedRows,
					relationName,
					relation,
					junctionCrud,
					relatedCrud,
					nestedOptions,
					context,
				});
			}
		}
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

			// Access explicitly denied
			if (accessWhere === false) {
				throw ApiError.forbidden({
					operation: "read",
					resource: this.state.name,
					reason: "User does not have permission to read records",
				});
			}

			const mergedWhere = this.mergeWhere(options.where, accessWhere);

			// i18n joins mirror the find query so localized fields are usable in
			// `where`. Joining on (parentId, locale) is unique per main row, so
			// the LEFT JOINs never change count cardinality.
			const useI18n = !!this.i18nTable;
			const needsFallback =
				useI18n &&
				normalized.localeFallback !== false &&
				normalized.locale !== normalized.defaultLocale;
			const i18nCurrentTable = useI18n
				? alias(this.i18nTable!, "i18n_current")
				: null;
			const i18nFallbackTable = needsFallback
				? alias(this.i18nTable!, "i18n_fallback")
				: null;

			// Build WHERE clause (with soft delete filter)
			let whereClause: SQL<unknown> | undefined;
			if (mergedWhere) {
				whereClause = this.buildWhereClause(
					mergedWhere,
					useI18n,
					undefined,
					normalized,
					undefined,
					i18nCurrentTable,
					i18nFallbackTable,
				);
			}

			// Add soft delete filter
			if (this.state.options.softDelete && !options.includeDeleted) {
				const deletedAtCol = getColumn(this.table, "deletedAt");
				const softDeleteClause = deletedAtCol
					? sql`${deletedAtCol} IS NULL`
					: undefined;
				whereClause = whereClause
					? and(whereClause, softDeleteClause)
					: softDeleteClause;
			}

			// Build count query
			let query: any = db.select({ count: count() }).from(this.table);

			if (useI18n && i18nCurrentTable) {
				query = query.leftJoin(
					i18nCurrentTable,
					and(
						eq(
							getColumn(i18nCurrentTable, "parentId")!,
							getColumn(this.table, "id")!,
						),
						eq(getColumn(i18nCurrentTable, "locale")!, normalized.locale!),
					),
				);

				if (needsFallback && i18nFallbackTable) {
					query = query.leftJoin(
						i18nFallbackTable,
						and(
							eq(
								getColumn(i18nFallbackTable, "parentId")!,
								getColumn(this.table, "id")!,
							),
							eq(
								getColumn(i18nFallbackTable, "locale")!,
								normalized.defaultLocale!,
							),
						),
					);
				}
			}

			if (whereClause) {
				query = query.where(whereClause);
			}

			const result = await query;
			return result[0]?.count ?? 0;
		};
	}

	/**
	 * Handle cascade delete operations for relations
	 * Delegates to extracted handleCascadeDelete utility
	 */
	private async handleCascadeDeleteInternal(
		_id: string,
		record: any,
		context: CRUDContext,
	): Promise<void> {
		if (!this.app || !this.state.relations) return;
		await handleCascadeDelete({
			record,
			relations: this.state.relations,
			app: this.app,
			context,
			resolveFieldKey: this.resolveFieldKey,
		});
	}

	/**
	 * Separate nested relation operations from regular fields
	 * Delegates to extracted separateNestedRelations utility
	 */
	private separateNestedRelationsInternal(input: any): {
		regularFields: any;
		nestedRelations: Record<string, any>;
	} {
		const relationNames = new Set(Object.keys(this.state.relations || {}));
		return separateNestedRelations(input, relationNames);
	}

	/**
	 * Apply belongsTo relation operations
	 * Delegates to extracted applyBelongsToRelations utility
	 */
	private async applyBelongsToRelationsInternal(
		regularFields: Record<string, any>,
		nestedRelations: Record<string, any>,
		context: CRUDContext,
		tx: any,
	): Promise<{
		regularFields: Record<string, any>;
		nestedRelations: Record<string, any>;
	}> {
		if (!this.app || !this.state.relations) {
			return { regularFields, nestedRelations };
		}
		return applyBelongsToRelations(
			regularFields,
			nestedRelations,
			this.state.relations,
			this.app,
			context,
			tx,
			this.resolveFieldKey,
			this.state,
			this.table,
		);
	}

	/**
	 * Pre-process connect operations before validation
	 * Delegates to extracted extractBelongsToConnectValues utility
	 */
	private preApplyConnectOperations(
		regularFields: Record<string, any>,
		nestedRelations: Record<string, any>,
	): {
		regularFields: Record<string, any>;
		nestedRelations: Record<string, any>;
	} {
		if (!this.state.relations) {
			return { regularFields, nestedRelations };
		}
		return extractBelongsToConnectValues(
			regularFields,
			nestedRelations,
			this.state.relations,
			this.resolveFieldKey,
			this.state,
			this.table,
		);
	}

	/**
	 * Process nested relation operations (create, connect, connectOrCreate)
	 * Delegates to extracted processNestedRelations utility
	 */
	private async processNestedRelationsInternal(
		parentRecord: any,
		nestedRelations: Record<string, any>,
		context: CRUDContext,
		tx: any,
	): Promise<void> {
		if (!this.app || !this.state.relations) return;
		await processNestedRelations({
			parentRecord,
			nestedRelations,
			relations: this.state.relations,
			app: this.app,
			context,
			tx,
			resolveFieldKey: this.resolveFieldKey,
		});
	}

	/**
	 * Create create operation
	 */
	private createCreate() {
		return async (input: CreateInput, context: CRUDContext = {}) => {
			// Normalize context FIRST to ensure locale defaults are applied
			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);

			// Run entire operation within request-scoped context
			// This enables implicit getContext<TApp>() calls in hooks/access control
			const _hookDepth = guardHookRecursion();
			return runWithContext(
				{
					app: this.app,
					session: normalized.session,
					db,
					locale: normalized.locale,
					accessMode: normalized.accessMode,
					stage: normalized.stage,
					"~contextExtensions": normalized["~contextExtensions"],
					_hookDepth,
				},
				async () => {
					// Execute beforeOperation hook
					await this.executeHooks(
						this.state.hooks?.beforeOperation,
						this.createHookContext({
							data: input,
							operation: "create",
							context: normalized,
							db,
						}),
					);

					// Enforce access control
					const canCreate = await this.enforceAccessControl(
						"create",
						normalized,
						null,
						input,
					);
					if (canCreate === false) {
						throw ApiError.forbidden({
							operation: "create",
							resource: this.state.name,
							reason: "User does not have permission to create records",
						});
					}

					// Execute beforeValidate hook (transform input before validation)
					await this.executeHooks(
						this.state.hooks?.beforeValidate,
						this.createHookContext({
							data: input,
							operation: "create",
							context: normalized,
							db,
						}),
					);

					// Separate nested relation operations from regular fields BEFORE validation
					// This prevents the validation schema from stripping relation fields
					let { regularFields, nestedRelations } =
						this.separateNestedRelationsInternal(input);

					// Pre-apply connect operations to extract FK values before validation
					// This allows validation to pass when FK fields are provided via nested relation syntax
					({ regularFields, nestedRelations } = this.preApplyConnectOperations(
						regularFields,
						nestedRelations,
					));

					// Decode any pre-stringified jsonb values before any hook or write
					// path observes them — see normalizeJsonbInput.
					regularFields = normalizeJsonbInput(
						regularFields,
						this.state.fieldDefinitions,
					);

					// Validate field-level write access (on regular fields only)
					await this.validateFieldWriteAccess(
						regularFields,
						normalized,
						"create",
					);

					// Runtime validation (if schemas are configured)
					if (this.state.validation?.insertSchema) {
						try {
							// Validate and potentially transform the regular fields only
							regularFields =
								this.state.validation.insertSchema.parse(regularFields);
						} catch (error: any) {
							throw ApiError.fromZodError(error);
						}
					}

					regularFields = await this.runFieldInputHooks(
						regularFields,
						"create",
						normalized,
						db,
					);

					// Execute beforeChange hooks (after validation)
					await this.executeCollectionHooksWithGlobal(
						"beforeChange",
						this.state.hooks?.beforeChange,
						this.createHookContext({
							data: regularFields,
							operation: "create",
							context,
							db,
						}),
					);
					let record: any;
					try {
						record = await withTransaction(db, async (tx: any) => {
							({ regularFields, nestedRelations } =
								await this.applyBelongsToRelationsInternal(
									regularFields,
									nestedRelations,
									context,
									tx,
								));

							// Split localized vs non-localized fields
							// Auto-detects { $i18n: value } wrappers in JSONB fields
							const { localized, nonLocalized, nestedLocalized } =
								this.splitLocalizedFields(regularFields);

							// Insert main record
							const [insertedRecord] = await tx
								.insert(this.table)
								.values(nonLocalized)
								.returning();

							// Insert localized fields if any (flat fields + nested localized in _localized column)
							const hasLocalizedData =
								Object.keys(localized).length > 0 || nestedLocalized != null;
							if (this.i18nTable && context.locale && hasLocalizedData) {
								await tx.insert(this.i18nTable).values({
									parentId: insertedRecord.id,
									locale: context.locale,
									...localized,
									...(nestedLocalized != null
										? { _localized: nestedLocalized }
										: {}),
								});
							}

							// Process nested relation operations (create, connect, connectOrCreate)
							await this.processNestedRelationsInternal(
								insertedRecord,
								nestedRelations,
								context,
								tx,
							);

							// Create version
							await this.createVersion(tx, insertedRecord, "create", context);

							// Re-fetch record with all computed fields (including _title)
							// If i18n table exists, we MUST use i18n queries to properly fetch localized fields
							const useI18n = !!this.i18nTable;
							const needsFallback =
								useI18n &&
								normalized.localeFallback !== false &&
								normalized.locale !== normalized.defaultLocale;
							const i18nCurrentTable = useI18n
								? alias(this.i18nTable!, "i18n_current")
								: null;
							const i18nFallbackTable = needsFallback
								? alias(this.i18nTable!, "i18n_fallback")
								: null;

							const selectObj = this.buildSelectObject(
								undefined,
								undefined,
								context,
								i18nCurrentTable,
								i18nFallbackTable,
							);
							let query = tx.select(selectObj).from(this.table);

							if (useI18n && i18nCurrentTable) {
								query = query.leftJoin(
									i18nCurrentTable,
									and(
										eq(
											getColumn(i18nCurrentTable, "parentId")!,
											getColumn(this.table, "id")!,
										),
										eq(getColumn(i18nCurrentTable, "locale")!, context.locale!),
									),
								);

								if (needsFallback && i18nFallbackTable) {
									query = query.leftJoin(
										i18nFallbackTable,
										and(
											eq(
												getColumn(i18nFallbackTable, "parentId")!,
												getColumn(this.table, "id")!,
											),
											eq(
												getColumn(i18nFallbackTable, "locale")!,
												context.defaultLocale!,
											),
										),
									);
								}
							}

							let [createdRecord] = await query.where(
								eq(getColumn(this.table, "id")!, insertedRecord.id),
							);

							// Application-side i18n merge
							// Handles both flat localized fields and nested localized JSONB fields (via _localized column)
							const hasLocalizedCreate = this.hasLocalizedFieldsInternal();
							if (useI18n && createdRecord && hasLocalizedCreate) {
								[createdRecord] = mergeI18nRows([createdRecord], {
									localizedFields: this.getLocalizedFieldNames(),
									hasFallback: needsFallback,
								});
							}

							// Execute afterChange hooks
							await this.executeCollectionHooksWithGlobal(
								"afterChange",
								this.state.hooks?.afterChange,
								this.createHookContext({
									data: createdRecord,
									operation: "create",
									context,
									db: tx,
								}),
							);

							// Queue search indexing to run after transaction commits (fire-and-forget)

							return createdRecord;
						});
					} catch (error: unknown) {
						// Check if it's a database constraint violation
						const dbError = parseDatabaseError(error);
						if (dbError) {
							throw dbError;
						}
						// Re-throw if not a known database error
						throw error;
					}

					// Execute afterRead hook (transform output)
					await this.runFieldOutputHooks(record, "create", normalized, db);

					await this.executeHooks(
						this.state.hooks?.afterRead,
						this.createHookContext({
							data: record,
							operation: "create",
							context: normalized,
							db,
						}),
					);
					await this.filterFieldsForRead(record, normalized);
					return record;
				},
			);
		};
	}

	/**
	 * Claim-checked writes: lock candidate rows and re-assert the caller's
	 * predicate at write time, inside the write transaction.
	 *
	 * The write pipeline evaluates `where` in a pre-SELECT and then mutates by
	 * id — without this step, two parallel conditional writes (claims,
	 * optimistic-version checks, state transitions) could both "win" (TOCTOU).
	 *
	 * 1. `SELECT id … WHERE id IN (candidates) ORDER BY id FOR UPDATE` locks
	 *    surviving candidate rows in deterministic order. Competing writers on
	 *    the same rows serialize on these locks, so the recheck below cannot be
	 *    invalidated before our transaction commits. Rows deleted by a
	 *    committed competitor are simply absent.
	 * 2. Unless the predicate is id-only (ids are immutable — locked ⇒ still
	 *    matching), re-evaluate the caller's original `where` as a fresh
	 *    statement through the find pipeline on the tx connection. Under READ
	 *    COMMITTED a fresh statement gets a fresh snapshot, so every committed
	 *    competing write is visible — uniform across predicate shapes (i18n
	 *    fallbacks, relation quantifiers, RAW SQL).
	 *
	 * Returns the ids of rows that still match ("winners"). Every mutation
	 * step must be scoped to these ids.
	 */
	private async claimRecords(args: {
		tx: any;
		txContext: CRUDContext;
		candidateIds: Array<string | number>;
		/** Caller's original where (bulk ops). Omit for by-id operations. */
		where?: Where;
		/** Soft-delete visibility the candidate pre-SELECT used. */
		includeDeleted?: boolean;
		/** Stage the candidate pre-SELECT was evaluated at. */
		stage?: string;
	}): Promise<Array<string | number>> {
		const { tx, txContext, candidateIds, where } = args;
		if (candidateIds.length === 0) return [];

		const idColumn = getColumn(this.table, "id")!;
		const lockedRows: Array<{ id: string | number }> = await tx
			.select({ id: idColumn })
			.from(this.table)
			.where(inArray(idColumn, candidateIds))
			.orderBy(asc(idColumn))
			.for("update");
		const lockedIds = lockedRows.map((row) => row.id);

		if (lockedIds.length === 0 || !where || isIdOnlyWhere(where)) {
			return lockedIds;
		}

		const recheckResult = (await this._executeFind(
			{
				where: { AND: [where, { id: { in: lockedIds } }] } as Where,
				includeDeleted: args.includeDeleted === true,
			},
			{ ...txContext, accessMode: "system", stage: args.stage },
			"many",
			{ skipOutputHooks: true },
		)) as PaginatedResult<any>;

		const matched = new Set(recheckResult.docs.map((doc: any) => doc.id));
		return lockedIds.filter((id) => matched.has(id));
	}

	/**
	 * Shared core update handler for updateById and updateMany
	 * Ensures consistency in access control, hooks, validation, and re-fetching.
	 *
	 * Hook semantics for conditional (bulk where) updates:
	 * - `beforeValidate`/`beforeChange` run BEFORE the transaction on
	 *   pre-images — they are *intent* hooks and may fire for rows that lose
	 *   the write-time claim check.
	 * - `afterChange`, versioning, and the return value are driven by the
	 *   in-transaction re-fetch of claimed rows — they are *fact* hooks and
	 *   fire for winners only.
	 */
	private async _executeUpdate(
		params:
			| UpdateParams<any, any, string | number>
			| { where: Where; data: Record<string, any> },
		context: CRUDContext = {},
	) {
		const normalized = this.normalizeContext(context);

		const db = this.getDb(normalized);
		const isBatch = "where" in params;
		const data = params.data;

		// 1. Execute beforeOperation hook
		await this.executeHooks(
			this.state.hooks?.beforeOperation,
			this.createHookContext({
				data,
				operation: "update",
				context: normalized,
				db,
			}),
		);

		// 2. Load existing records
		// Use system mode to ensure hooks have access to full records regardless of read permissions
		const findOptions: FindManyOptions = isBatch
			? { where: (params as { where: Where }).where }
			: { where: { id: (params as { id: string | number }).id } };

		const recordsResult = (await this._executeFind(
			{ ...findOptions, includeDeleted: true },
			{
				...normalized,
				accessMode: "system",
				stage: this.workflowConfig?.initialStage,
			},
			"many",
		)) as PaginatedResult<any>;

		const records = recordsResult.docs;

		if (records.length === 0) {
			if (isBatch) return [];
			throw ApiError.notFound(
				"Record",
				String((params as { id: string | number }).id),
			);
		}

		// 3. Process each record (Access Control + beforeValidate)
		for (const existing of records) {
			// Enforce access control
			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				data,
			);
			if (canUpdate === false) {
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: `User does not have permission to update record ${existing.id}`,
				});
			}
			if (typeof canUpdate === "object") {
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw ApiError.forbidden({
						operation: "update",
						resource: this.state.name,
						reason: `Record ${existing.id} does not match access control conditions`,
					});
				}
			}

			// Execute beforeValidate hook (transform input before validation)
			await this.executeHooks(
				this.state.hooks?.beforeValidate,
				this.createHookContext({
					data,
					original: existing,
					operation: "update",
					context: normalized,
					db,
				}),
			);
		}

		// Separate nested relation operations from regular fields BEFORE validation
		// This prevents the validation schema from stripping relation fields
		let { regularFields, nestedRelations } =
			this.separateNestedRelationsInternal(data);

		// Decode any pre-stringified jsonb values before any hook or write
		// path observes them. Drizzle stringifies jsonb values itself; if a
		// caller (legacy seed, RPC, etc.) passes an already-encoded JSON
		// string for a jsonb column, double-encoding stores a jsonb string
		// instead of the intended array/object.
		regularFields = normalizeJsonbInput(
			regularFields,
			this.state.fieldDefinitions,
		);

		// 4. Global Validation (Zod)
		if (this.state.validation?.updateSchema) {
			try {
				// Validate and potentially transform the regular fields only
				regularFields = this.state.validation.updateSchema.parse(regularFields);
			} catch (error: any) {
				if (error?.name === "ZodError") {
					throw ApiError.fromZodError(error);
				}
				throw ApiError.badRequest(`Validation error: ${error.message}`);
			}
		}

		// 5. beforeChange hooks

		// Compute bulk metadata once (available to all hook invocations)
		const bulkMeta = isBatch
			? {
					isBatch: true as const,
					recordIds: records.map((r: any) => r.id),
					records,
					count: records.length,
				}
			: undefined;

		for (const existing of records) {
			// Validate field-level write access
			await this.validateFieldWriteAccess(
				regularFields,
				normalized,
				"update",
				existing,
			);

			regularFields = await this.runFieldInputHooks(
				regularFields,
				"update",
				normalized,
				db,
				existing,
			);

			await this.executeCollectionHooksWithGlobal(
				"beforeChange",
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: regularFields,
					original: existing,
					operation: "update",
					context: normalized,
					db,
					bulk: bulkMeta,
				}),
			);
		}
		let updatedRecords: any[];

		try {
			updatedRecords = await withTransaction(db, async (tx: any) => {
				const txContext = { ...normalized, db: tx };

				// Claim check: lock candidate rows and re-assert the caller's
				// predicate at write time. Rows that no longer match (lost a
				// concurrent claim, vanished, ...) are excluded from every
				// mutation below.
				const recordIds = await this.claimRecords({
					tx,
					txContext,
					candidateIds: records.map((r: any) => r.id),
					where: isBatch ? (params as { where: Where }).where : undefined,
					includeDeleted: true,
					stage: this.workflowConfig?.initialStage,
				});

				if (recordIds.length === 0) {
					if (!isBatch) {
						// Row vanished between the pre-SELECT and the row lock
						throw ApiError.notFound(
							"Record",
							String((params as { id: string | number }).id),
						);
					}
					return [];
				}

				const winnerIds = new Set(recordIds);
				const winners = records.filter((r: any) => winnerIds.has(r.id));

				// Apply belongsTo relations
				({ regularFields, nestedRelations } =
					await this.applyBelongsToRelationsInternal(
						regularFields,
						nestedRelations,
						txContext,
						tx,
					));

				// Split localized vs non-localized fields
				const { localized, nonLocalized, nestedLocalized } =
					this.splitLocalizedFields(regularFields);

				// Update main table
				if (
					Object.keys(nonLocalized).length > 0 ||
					this.state.options.timestamps !== false
				) {
					await tx
						.update(this.table)
						.set({
							...nonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(inArray(getColumn(this.table, "id")!, recordIds));
				}

				// Upsert localized fields
				const hasLocalizedData =
					Object.keys(localized).length > 0 || nestedLocalized != null;
				if (this.i18nTable && normalized.locale && hasLocalizedData) {
					const i18nValues = {
						...localized,
						...(nestedLocalized != null ? { _localized: nestedLocalized } : {}),
					};

					// Batch upsert: single multi-row INSERT...ON CONFLICT
					const allRows = recordIds.map((recordId) => ({
						parentId: recordId,
						locale: normalized.locale,
						...i18nValues,
					}));
					if (allRows.length > 0) {
						await tx
							.insert(this.i18nTable)
							.values(allRows)
							.onConflictDoUpdate({
								target: [
									getColumn(this.i18nTable, "parentId")!,
									getColumn(this.i18nTable, "locale")!,
								],
								set: i18nValues,
							});
					}
				}

				// Process nested relation operations (winners only)
				for (const existing of winners) {
					await this.processNestedRelationsInternal(
						existing,
						nestedRelations,
						txContext,
						tx,
					);
				}

				// Re-fetch updated records WITHOUT field output hooks / afterRead.
				// Field output hooks run AFTER the transaction commits — running
				// them inside the tx caused inner CRUD calls (e.g. blocks prefetch
				// hitting other collections) to inherit `db: tx` via context
				// propagation, serializing every parallel inner query through the
				// tx connection. Bun SQL can deadlock when many parallel queries
				// queue behind an open tx, leaving the response un-read and the
				// connection stuck `idle in transaction`.
				const reFetchResult = (await this._executeFind(
					{ where: { id: { in: recordIds } }, includeDeleted: true },
					{
						...txContext,
						accessMode: "system",
						stage: this.workflowConfig?.initialStage,
					},
					"many",
					{ skipOutputHooks: true },
				)) as PaginatedResult<any>;

				const refetchedRecords = reFetchResult.docs;

				// Create versions and run afterChange hooks
				// Bulk metadata for afterChange: post-image records
				const afterBulkMeta = isBatch
					? {
							isBatch: true as const,
							recordIds: refetchedRecords.map((r: any) => r.id),
							records: refetchedRecords,
							count: refetchedRecords.length,
						}
					: undefined;

				const afterChangePromises: Promise<void>[] = [];
				for (const updated of refetchedRecords) {
					const original = records.find((r) => r.id === updated.id);

					await this.createVersion(tx, updated, "update", txContext);

					// Collect afterChange hooks for parallel execution in bulk
					afterChangePromises.push(
						this.executeCollectionHooksWithGlobal(
							"afterChange",
							this.state.hooks?.afterChange,
							this.createHookContext({
								data: updated,
								original,
								operation: "update",
								context: txContext,
								db: tx,
								bulk: afterBulkMeta,
							}),
						).catch((err) => {
							console.error(
								`[QUESTPIE] afterChange hook error in bulk update:`,
								err,
							);
						}),
					);
				}
				// Execute all afterChange hooks in parallel (non-fatal)
				await Promise.allSettled(afterChangePromises);

				return refetchedRecords;
			});
		} catch (error: unknown) {
			const dbError = parseDatabaseError(error);
			if (dbError) throw dbError;
			throw error;
		}

		// 6. afterRead hooks and notifications
		for (const updated of updatedRecords) {
			const original = records.find((r) => r.id === updated.id);

			await this.runFieldOutputHooks(
				updated,
				"update",
				normalized,
				db,
				original,
			);

			await this.executeHooks(
				this.state.hooks?.afterRead,
				this.createHookContext({
					data: updated,
					original,
					operation: "update",
					context: normalized,
					db,
				}),
			);
			await this.filterFieldsForRead(updated, normalized);
		}

		return isBatch ? updatedRecords : updatedRecords[0];
	}

	/**
	 * Create update operation
	 */
	private createUpdate() {
		return async (params: UpdateParams, context: CRUDContext = {}) => {
			return this._executeUpdate(params, context);
		};
	}

	/**
	 * Create delete operation (supports soft delete)
	 */
	private createDelete() {
		return async (params: DeleteParams, context: CRUDContext = {}) => {
			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);
			const { id } = params;

			// Execute beforeOperation hook
			await this.executeHooks(
				this.state.hooks?.beforeOperation,
				this.createHookContext({
					data: params,
					operation: "delete",
					context: normalized,
					db,
				}),
			);

			// Load existing record
			// Use select instead of query to avoid dependency on query builder structure which might not exist if collection not registered in db.query
			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq(getColumn(this.table, "id")!, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw ApiError.notFound("Record", id);
			}

			// Enforce access control
			const canDelete = await this.enforceAccessControl(
				"delete",
				normalized,
				existing,
				params,
			);
			if (canDelete === false) {
				throw ApiError.forbidden({
					operation: "delete",
					resource: this.state.name,
					reason: "User does not have permission to delete this record",
				});
			}
			if (typeof canDelete === "object") {
				// Check if existing record matches access conditions
				const matchesConditions = await this.checkAccessConditions(
					canDelete,
					existing,
				);
				if (!matchesConditions) {
					throw ApiError.forbidden({
						operation: "delete",
						resource: this.state.name,
						reason: "Record does not match access control conditions",
					});
				}
			}

			// Execute beforeDelete hooks
			await this.executeCollectionHooksWithGlobal(
				"beforeDelete",
				this.state.hooks?.beforeDelete,
				this.createHookContext({
					data: existing,
					original: existing,
					operation: "delete",
					context: normalized,
					db,
				}),
			);

			// Use transaction for delete + version
			await withTransaction(db, async (tx: any) => {
				const txContext = { ...normalized, db: tx };

				// Claim check: lock the row; if it vanished since the pre-SELECT,
				// fail loud instead of silently deleting nothing.
				const claimed = await this.claimRecords({
					tx,
					txContext,
					candidateIds: [id],
				});
				if (claimed.length === 0) {
					throw ApiError.notFound("Record", id);
				}

				await this.handleCascadeDeleteInternal(id, existing, txContext);

				// Create version BEFORE delete
				await this.createVersion(tx, existing, "delete", txContext);

				// Soft delete or hard delete
				if (this.state.options.softDelete) {
					await tx
						.update(this.table)
						.set({ deletedAt: new Date() })
						.where(eq(getColumn(this.table, "id")!, id));
				} else {
					await tx
						.delete(this.table)
						.where(eq(getColumn(this.table, "id")!, id));
				}

				// Execute afterDelete hooks inside transaction (non-fatal)
				try {
					await this.executeCollectionHooksWithGlobal(
						"afterDelete",
						this.state.hooks?.afterDelete,
						this.createHookContext({
							data: existing,
							original: existing,
							operation: "delete",
							context: txContext,
							db: tx,
						}),
					);
				} catch (err) {
					// afterDelete hook errors are non-fatal — log and continue
					console.error(
						`[QUESTPIE] afterDelete hook error for "${this.state.name}":`,
						err,
					);
				}
			});

			const result = { success: true, data: existing };

			// Execute afterRead hook (transform output)
			await this.executeHooks(
				this.state.hooks?.afterRead,
				this.createHookContext({
					data: existing,
					original: existing,
					operation: "delete",
					context: normalized,
					db,
				}),
			);
			await this.filterFieldsForRead(existing, normalized);

			return result;
		};
	}

	/**
	 * Restore soft-deleted record by ID
	 */
	private createRestore() {
		return async (params: RestoreParams, context: CRUDContext = {}) => {
			if (!this.state.options.softDelete) {
				throw ApiError.notImplemented("Soft delete");
			}

			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);
			const { id } = params;

			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq(getColumn(this.table, "id")!, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw ApiError.notFound("Record", id);
			}

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				{ deletedAt: null },
			);
			if (canUpdate === false) {
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to restore this record",
				});
			}
			if (typeof canUpdate === "object") {
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw ApiError.forbidden({
						operation: "update",
						resource: this.state.name,
						reason: "Record does not match access control conditions",
					});
				}
			}

			if (!existing.deletedAt) {
				await this.filterFieldsForRead(existing, normalized);
				return existing;
			}

			const updateFn = this.createUpdate();
			return await updateFn(
				{
					id,
					data: { deletedAt: null } as Record<string, unknown>,
				},
				normalized,
			);
		};
	}

	/**
	 * Create updateMany operation - smart batched updates
	 */
	private createUpdateMany() {
		return async (
			params: { where: Where; data: UpdateParams["data"] },
			context: CRUDContext = {},
		) => {
			return this._executeUpdate(params, context);
		};
	}

	/**
	 * Create updateBatch operation - heterogeneous updates in one transaction.
	 */
	private createUpdateBatch() {
		return async (
			params: {
				updates: Array<{ id: string | number; data: UpdateParams["data"] }>;
			},
			context: CRUDContext = {},
		) => {
			if (!Array.isArray(params.updates)) {
				throw ApiError.badRequest(
					"updates must be an array",
					undefined,
					"error.updatesMustBeArray",
				);
			}

			if (params.updates.length === 0) {
				return [];
			}

			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);

			return withTransaction(db, async (tx: any) => {
				const txContext = { ...normalized, db: tx };
				const updatedRecords: any[] = [];

				for (const update of params.updates) {
					updatedRecords.push(
						await this._executeUpdate(
							{ id: update.id, data: update.data },
							txContext,
						),
					);
				}

				return updatedRecords;
			});
		};
	}

	/**
	 * Create deleteMany operation - smart batched deletes
	 * 1. find to get all matching records (for hooks + access control)
	 * 2. Loop through beforeDelete hooks
	 * 3. Single batched DELETE WHERE query
	 * 4. Loop through afterDelete hooks
	 */
	private createDeleteMany() {
		return async (params: { where: Where }, context: CRUDContext = {}) => {
			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);
			const find = this.createFind();

			// 1. Find all matching records (for hooks and access control)
			const { docs: records } = await find({ where: params.where }, normalized);

			if (records.length === 0) {
				return { success: true, count: 0 };
			}

			// Compute bulk metadata (pre-image for delete)
			const deleteBulkMeta = {
				isBatch: true as const,
				recordIds: records.map((r: any) => r.id),
				records,
				count: records.length,
			};

			// 2. Loop through beforeDelete hooks and access control
			for (const record of records) {
				// Check access control per record
				const canDelete = await this.enforceAccessControl(
					"delete",
					normalized,
					record,
					params,
				);
				if (canDelete === false) {
					throw ApiError.forbidden({
						operation: "delete",
						resource: this.state.name,
						reason: `User does not have permission to delete record ${record.id}`,
					});
				}
				if (typeof canDelete === "object") {
					const matchesConditions = await this.checkAccessConditions(
						canDelete,
						record,
					);
					if (!matchesConditions) {
						throw ApiError.forbidden({
							operation: "delete",
							resource: this.state.name,
							reason: `Record ${record.id} does not match access control conditions`,
						});
					}
				}

				// Execute beforeDelete hooks
				await this.executeCollectionHooksWithGlobal(
					"beforeDelete",
					this.state.hooks?.beforeDelete,
					this.createHookContext({
						data: record,
						original: record,
						operation: "delete",
						context: normalized,
						db,
						bulk: deleteBulkMeta,
					}),
				);
			}
			// 3. Batched DELETE query
			// Claim check inside the tx: only rows that STILL match the caller's
			// where at delete time are deleted ("winners").
			const winners: any[] = await withTransaction(db, async (tx: any) => {
				const txContext = { ...normalized, db: tx };

				const winnerIdList = await this.claimRecords({
					tx,
					txContext,
					candidateIds: records.map((r: any) => r.id),
					where: params.where,
					includeDeleted: false,
					stage: normalized.stage,
				});
				if (winnerIdList.length === 0) return [];

				const winnerIds = new Set(winnerIdList);
				const claimedRecords = records.filter((r: any) => winnerIds.has(r.id));

				for (const record of claimedRecords) {
					await this.handleCascadeDeleteInternal(record.id, record, txContext);
				}

				// Create versions BEFORE delete
				for (const record of claimedRecords) {
					await this.createVersion(tx, record, "delete", txContext);
				}

				// Batched soft delete or hard delete
				if (this.state.options.softDelete) {
					await tx
						.update(this.table)
						.set({ deletedAt: new Date() })
						.where(inArray(getColumn(this.table, "id")!, winnerIdList));
				} else {
					await tx
						.delete(this.table)
						.where(inArray(getColumn(this.table, "id")!, winnerIdList));
				}

				// Bulk metadata for afterDelete: winners only (fact hooks)
				const afterDeleteBulkMeta = {
					isBatch: true as const,
					recordIds: claimedRecords.map((record) => record.id),
					records: claimedRecords,
					count: claimedRecords.length,
				};

				// Execute afterDelete hooks inside the mutation transaction so
				// transactional side effects share the business commit boundary.
				for (const record of claimedRecords) {
					try {
						await this.executeCollectionHooksWithGlobal(
							"afterDelete",
							this.state.hooks?.afterDelete,
							this.createHookContext({
								data: record,
								original: record,
								operation: "delete",
								context: txContext,
								db: tx,
								bulk: afterDeleteBulkMeta,
							}),
						);
					} catch (err) {
						// afterDelete hook errors are non-fatal — log and continue
						console.error(
							`[QUESTPIE] afterDelete hook error for "${this.state.name}":`,
							err,
						);
					}
				}

				return claimedRecords;
			});

			return { success: true, count: winners.length };
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
			if (!canRead)
				throw ApiError.forbidden({
					operation: "read",
					resource: `${this.state.name} versions`,
					reason: "User does not have permission to read version history",
				});

			let query: any;

			// Determine i18n setup
			const useI18n = !!this.i18nVersionsTable && !!normalized.locale;
			const needsFallback =
				useI18n &&
				normalized.localeFallback !== false &&
				normalized.locale !== normalized.defaultLocale;
			const i18nVersionsCurrentTable = useI18n
				? alias(this.i18nVersionsTable!, "i18n_v_current")
				: null;
			const i18nVersionsFallbackTable = needsFallback
				? alias(this.i18nVersionsTable!, "i18n_v_fallback")
				: null;

			if (useI18n && i18nVersionsCurrentTable) {
				// When we have i18n, use select-from-join pattern
				const selectObj = this.buildVersionsSelectObject(
					normalized,
					i18nVersionsCurrentTable,
					i18nVersionsFallbackTable,
				);
				query = db
					.select(selectObj)
					.from(this.versionsTable)
					.$dynamic()
					.leftJoin(
						i18nVersionsCurrentTable,
						and(
							eq(
								getColumn(i18nVersionsCurrentTable, "parentId")!,
								getColumn(this.versionsTable!, "id")!,
							),
							eq(
								getColumn(i18nVersionsCurrentTable, "versionNumber")!,
								getColumn(this.versionsTable!, "versionNumber")!,
							),
							eq(
								getColumn(i18nVersionsCurrentTable, "locale")!,
								normalized.locale!,
							),
						),
					);

				// Add fallback join if needed
				if (needsFallback && i18nVersionsFallbackTable) {
					query = query.leftJoin(
						i18nVersionsFallbackTable,
						and(
							eq(
								getColumn(i18nVersionsFallbackTable, "parentId")!,
								getColumn(this.versionsTable!, "id")!,
							),
							eq(
								getColumn(i18nVersionsFallbackTable, "versionNumber")!,
								getColumn(this.versionsTable!, "versionNumber")!,
							),
							eq(
								getColumn(i18nVersionsFallbackTable, "locale")!,
								normalized.defaultLocale!,
							),
						),
					);
				}

				query = query
					.where(eq(getColumn(this.versionsTable!, "id")!, options.id))
					.orderBy(
						sql`${getColumn(this.versionsTable!, "versionNumber")!} ASC`,
					);
			} else {
				// Without i18n, simpler select
				query = db
					.select(this.buildVersionsSelectObject(normalized))
					.from(this.versionsTable)
					.where(eq(getColumn(this.versionsTable!, "id")!, options.id))
					.orderBy(
						sql`${getColumn(this.versionsTable!, "versionNumber")!} ASC`,
					);
			}

			if (options.limit) {
				query = query.limit(options.limit);
			}
			if (options.offset) {
				query = query.offset(options.offset);
			}

			let rows = await query;

			// Application-side i18n merge for versions
			// Handles both flat localized fields and nested localized JSONB fields (via _localized column)
			const hasLocalizedVersions = this.hasLocalizedFieldsInternal();
			if (useI18n && rows.length > 0 && hasLocalizedVersions) {
				rows = mergeI18nRows(rows, {
					localizedFields: this.getLocalizedFieldNames(),
					hasFallback: needsFallback,
				});
			}

			return rows;
		};
	}

	/**
	 * Revert to a specific version
	 */
	private createRevertToVersion() {
		return async (options: RevertVersionOptions, context: CRUDContext = {}) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			if (!this.versionsTable) throw ApiError.notImplemented("Versioning");
			const hasVersionId = typeof options.versionId === "string";
			const hasVersion = typeof options.version === "number";

			if (!hasVersionId && !hasVersion) {
				throw ApiError.badRequest(
					"Version or versionId required",
					undefined,
					"error.versionRequired",
				);
			}

			const versionRows = await db
				.select()
				.from(this.versionsTable)
				.where(
					hasVersionId
						? and(
								eq(getColumn(this.versionsTable!, "id")!, options.id),
								eq(
									getColumn(this.versionsTable!, "versionId")!,
									options.versionId,
								),
							)
						: and(
								eq(getColumn(this.versionsTable!, "id")!, options.id),
								eq(
									getColumn(this.versionsTable!, "versionNumber")!,
									options.version,
								),
							),
				)
				.limit(1);
			const version = versionRows[0];

			if (!version)
				throw ApiError.notFound(
					"Version",
					options.versionId || String(options.version),
				);

			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq(getColumn(this.table, "id")!, options.id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw ApiError.notFound("Record", options.id);
			}

			const localizedFieldNames = this.getLocalizedFieldNames();
			const localizedFieldSet = new Set(localizedFieldNames);

			const nonLocalized: Record<string, any> = {};
			for (const [name] of Object.entries(this.state.fields)) {
				if (localizedFieldSet.has(name)) continue;
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
							eq(getColumn(this.i18nVersionsTable!, "parentId")!, options.id),
							eq(
								getColumn(this.i18nVersionsTable!, "versionNumber")!,
								version.versionNumber,
							),
							eq(
								getColumn(this.i18nVersionsTable!, "locale")!,
								normalized.locale,
							),
						),
					)
					.limit(1);
				const localeRow = localeRows[0];
				if (localeRow) {
					for (const fieldName of localizedFieldNames) {
						localizedForContext[fieldName] = localeRow[fieldName];
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
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to revert to this version",
				});
			}
			if (typeof canUpdate === "object") {
				const matchesConditions = await this.checkAccessConditions(
					canUpdate,
					existing,
				);
				if (!matchesConditions) {
					throw ApiError.forbidden({
						operation: "update",
						resource: this.state.name,
						reason: "Record does not match access control conditions",
					});
				}
			}

			await this.executeCollectionHooksWithGlobal(
				"beforeChange",
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: restoreData,
					original: existing,
					operation: "update",
					context: normalized,
					db,
				}),
			);

			const updated = await withTransaction(db, async (tx: any) => {
				if (Object.keys(nonLocalized).length > 0) {
					await tx
						.update(this.table)
						.set({
							...nonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(eq(getColumn(this.table, "id")!, options.id));
				}

				if (this.i18nTable && this.i18nVersionsTable) {
					await tx
						.delete(this.i18nTable)
						.where(eq(getColumn(this.i18nTable!, "parentId")!, options.id));

					const localeRows = await tx
						.select()
						.from(this.i18nVersionsTable)
						.where(
							and(
								eq(getColumn(this.i18nVersionsTable!, "parentId")!, options.id),
								eq(
									getColumn(this.i18nVersionsTable!, "versionNumber")!,
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
					.where(eq(getColumn(this.table, "id")!, options.id))
					.limit(1);
				const result = updatedRows[0];

				await this.createVersion(
					tx,
					result,
					"update",
					normalized,
					version.versionStage,
				);

				await this.executeCollectionHooksWithGlobal(
					"afterChange",
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: result,
						original: existing,
						operation: "update",
						context: normalized,
						db: tx,
					}),
				);

				// Queue search indexing to run after transaction commits (fire-and-forget)
				if (result) {
				}

				return result;
			});

			await this.filterFieldsForRead(updated, normalized);
			return updated;
		};
	}

	/**
	 * Transition a record to a different workflow stage without data mutation.
	 * Validates workflow is enabled, stage exists, transition is allowed,
	 * creates a version snapshot at the target stage, and broadcasts realtime.
	 */
	private createTransitionStage() {
		return async (params: TransitionStageParams, context: CRUDContext = {}) => {
			if (!this.workflowConfig) {
				throw ApiError.badRequest(
					`Workflow is not enabled for collection "${this.state.name}"`,
				);
			}

			const { id, stage: toStage, scheduledAt } = params;

			const normalized = this.normalizeContext(context);
			const db = this.getDb(normalized);

			// Validate target stage exists
			const stageExists = this.workflowConfig.stages.some(
				(s) => s.name === toStage,
			);
			if (!stageExists) {
				throw ApiError.badRequest(
					`Unknown workflow stage "${toStage}" for collection "${this.state.name}"`,
				);
			}

			// Load existing record
			const existingRows = await db
				.select()
				.from(this.table)
				.where(eq(getColumn(this.table, "id")!, id))
				.limit(1);
			const existing = existingRows[0];

			if (!existing) {
				throw ApiError.notFound("Record", id);
			}

			// Enforce access control: access.transition with fallback to access.update
			if (normalized.accessMode !== "system") {
				const accessRule =
					this.state.access?.transition ??
					this.state.access?.update ??
					this.app?.defaultAccess?.update;
				const canTransition = await executeAccessRule(accessRule, {
					app: this.app,
					db,
					session: normalized.session,
					locale: normalized.locale,
					row: existing,
					request:
						((context as any).req as Request | undefined) ??
						((context as any).request as Request | undefined),
					contextExtensions: normalized["~contextExtensions"],
				});
				if (canTransition === false) {
					throw ApiError.forbidden({
						operation: "update",
						resource: this.state.name,
						reason: "User does not have permission to transition this record",
					});
				}
				if (typeof canTransition === "object") {
					const matchesConditions = await this.checkAccessConditions(
						canTransition,
						existing,
					);
					if (!matchesConditions) {
						throw ApiError.forbidden({
							operation: "update",
							resource: this.state.name,
							reason: "Record does not match access control conditions",
						});
					}
				}
			}

			// Get current stage and assert transition allowed
			const fromStage = await this.getCurrentWorkflowStage(db, id);
			this.assertTransitionAllowed(fromStage, toStage);

			// Build transition hook context
			const transitionServices = extractAppServices(this.app, {
				db,
				session: normalized.session,
			});
			const transitionCtx: TransitionHookContext = {
				...transitionServices,
				...(normalized["~contextExtensions"] ?? {}),
				data: existing,
				recordId: id,
				fromStage,
				toStage,
				scheduledAt,
				locale: normalized.locale,
				accessMode: normalized.accessMode,
			} as TransitionHookContext;

			// Execute beforeTransition hooks (throw to abort).
			// TransitionScheduledError signals the transition was deferred to a queue job.
			try {
				await this.executeTransitionHooksWithGlobal(
					"beforeTransition",
					this.state.hooks?.beforeTransition,
					transitionCtx,
				);
			} catch (err) {
				if (err instanceof Error && err.name === "TransitionScheduledError") {
					// Transition was scheduled for future execution — return record unchanged
					await this.filterFieldsForRead(existing, normalized);
					return existing;
				}
				throw err;
			}

			// Create version snapshot at target stage (no data mutation)
			await withTransaction(db, async (tx: any) => {
				await createVersionRecord({
					tx,
					row: existing,
					operation: "update",
					versionsTable: this.versionsTable!,
					i18nVersionsTable: this.i18nVersionsTable,
					i18nTable: this.i18nTable,
					options: this.state.options,
					context: normalized,
					workflowStage: toStage,
					workflowFromStage: fromStage,
				});

				// Execute afterTransition hooks inside transaction (non-fatal)
				try {
					await this.executeTransitionHooksWithGlobal(
						"afterTransition",
						this.state.hooks?.afterTransition,
						transitionCtx,
					);
				} catch (err) {
					console.error(
						`[QUESTPIE] afterTransition hook error for "${this.state.name}":`,
						err,
					);
				}
			});

			await this.filterFieldsForRead(existing, normalized);
			return existing;
		};
	}

	/**
	 * Create a new version of the record
	 * Delegates to extracted createVersionRecord utility
	 */
	private async createVersion(
		tx: any,
		row: any,
		operation: "create" | "update" | "delete",
		context: CRUDContext,
		stageOverride?: string,
	) {
		if (!this.versionsTable) return;

		let workflowStage: string | undefined;
		let workflowFromStage: string | undefined;

		if (this.workflowConfig) {
			if (operation === "delete") {
				workflowFromStage = await this.getCurrentWorkflowStage(tx, row.id);
				workflowStage = workflowFromStage;
			} else {
				const requestedStage = stageOverride ?? this.getWriteStage(context);
				workflowStage = requestedStage;

				if (operation === "update") {
					workflowFromStage = await this.getCurrentWorkflowStage(tx, row.id);
					if (workflowStage) {
						this.assertTransitionAllowed(workflowFromStage, workflowStage);
					}
				}
			}
		}

		await createVersionRecord({
			tx,
			row,
			operation,
			versionsTable: this.versionsTable,
			i18nVersionsTable: this.i18nVersionsTable,
			i18nTable: this.i18nTable,
			options: this.state.options,
			context,
			workflowStage,
			workflowFromStage,
		});
	}

	/**
	 * Execute hooks (supports arrays)
	 * Delegates to shared executeHooks utility
	 */
	private async executeHooks(
		hooks: any | any[] | undefined,
		ctx: HookContext<any, any, any>,
	) {
		return executeHooks(hooks, ctx);
	}

	/**
	 * Execute collection-specific hooks AND global collection hooks for a lifecycle event.
	 * Global before* hooks run first; global after* hooks run last.
	 */
	/**
	 * Cached collection key (camelCase record key).
	 * Resolved lazily on first global hooks call.
	 */
	private _collectionKey: string | undefined;

	/**
	 * Resolve the collection key (camelCase record key) for this collection.
	 * Falls back to slug if the key cannot be determined.
	 * Used for include/exclude filtering in global hooks.
	 */
	private getCollectionKey(): string {
		if (this._collectionKey !== undefined) return this._collectionKey;
		if (!this.app) {
			this._collectionKey = this.state.name;
			return this._collectionKey;
		}
		const collections = this.app.getCollections();
		for (const [key, coll] of Object.entries(collections)) {
			if ((coll as any).state?.name === this.state.name) {
				this._collectionKey = key;
				return key;
			}
		}
		this._collectionKey = this.state.name;
		return this._collectionKey;
	}

	private async executeCollectionHooksWithGlobal(
		hookName: "beforeChange" | "afterChange" | "beforeDelete" | "afterDelete",
		collectionHooks: any | any[] | undefined,
		ctx: HookContext<any, any, any>,
	) {
		const globalEntries = this.app?.globalHooks?.collections;
		const isBefore = hookName.startsWith("before");
		const collectionKey = this.getCollectionKey();

		if (isBefore) {
			// Global before* first, then collection-specific
			await executeGlobalCollectionHooks(
				globalEntries,
				hookName,
				collectionKey,
				ctx,
			);
			await this.executeHooks(collectionHooks, ctx);
		} else {
			// Collection-specific first, then global after*
			await this.executeHooks(collectionHooks, ctx);
			await executeGlobalCollectionHooks(
				globalEntries,
				hookName,
				collectionKey,
				ctx,
			);
		}
	}

	/**
	 * Execute transition hooks (supports arrays).
	 * Uses TransitionHookContext instead of HookContext.
	 */
	private async executeTransitionHooks(
		hooks: any | any[] | undefined,
		ctx: TransitionHookContext,
	) {
		if (!hooks) return;
		const hookArray = Array.isArray(hooks) ? hooks : [hooks];
		for (const hook of hookArray) {
			await hook(ctx);
		}
	}

	/**
	 * Execute transition hooks AND global transition hooks.
	 */
	private async executeTransitionHooksWithGlobal(
		hookName: "beforeTransition" | "afterTransition",
		collectionHooks: any | any[] | undefined,
		ctx: TransitionHookContext,
	) {
		const globalEntries = this.app?.globalHooks?.collections;
		const isBefore = hookName === "beforeTransition";
		const collectionKey = this.getCollectionKey();

		if (isBefore) {
			await executeGlobalCollectionTransitionHooks(
				globalEntries,
				hookName,
				collectionKey,
				ctx,
			);
			await this.executeTransitionHooks(collectionHooks, ctx);
		} else {
			await this.executeTransitionHooks(collectionHooks, ctx);
			await executeGlobalCollectionTransitionHooks(
				globalEntries,
				hookName,
				collectionKey,
				ctx,
			);
		}
	}

	/**
	 * Create hook context with full app access
	 * Delegates to shared createHookContext utility
	 */
	private createHookContext(params: {
		data: any;
		original?: any;
		operation: "create" | "update" | "delete" | "read";
		context: CRUDContext;
		db: any;
		bulk?: {
			isBatch: true;
			recordIds: (string | number)[];
			records: any[];
			count: number;
		};
	}): HookContext<any, any, any> {
		return createHookContext({
			...params,
			app: this.app,
		});
	}

	/**
	 * Enforce access control for a CRUD operation.
	 *
	 * Resolution order:
	 * 1. Collection's own `.access()` rule for the operation
	 * 2. App-level `defaultAccess` (from `.defaultAccess()` on the builder)
	 * 3. Framework fallback in `executeAccessRule`: require session (`!!session`)
	 *
	 * System mode (`accessMode === "system"`) bypasses all access checks.
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

		// Use collection's access rule, or fall back to app defaultAccess
		const accessRule =
			this.state.access?.[operation] ?? this.app?.defaultAccess?.[operation];
		return executeAccessRule(accessRule, {
			app: this.app,
			db,
			session: normalized.session,
			locale: normalized.locale,
			row,
			input,
			request:
				((context as any).req as Request | undefined) ??
				((context as any).request as Request | undefined),
			contextExtensions: normalized["~contextExtensions"],
		});
	}

	/**
	 * Check if a row matches access conditions
	 * Delegates to extracted matchesAccessConditions utility
	 */
	private async checkAccessConditions(
		conditions: AccessWhere,
		row: any,
	): Promise<boolean> {
		return matchesAccessConditions(conditions, row);
	}

	/**
	 * Filter fields from result based on field-level read access
	 * Delegates to extracted getRestrictedReadFields utility
	 * Uses field definition access rules
	 */
	private async filterFieldsForRead(
		result: any,
		context: CRUDContext,
	): Promise<void> {
		if (!result) return;

		const db = this.getDb(context);
		const fieldAccess = this.getFieldAccessRules();

		const fieldsToRemove = await getRestrictedReadFields(result, context, {
			app: this.app,
			db,
			fieldAccess,
		});

		removeRestrictedReadFields(result, fieldsToRemove);
	}

	/**
	 * Validate write access for all fields in input data
	 * Delegates to extracted validateFieldsWriteAccess utility
	 * Uses field definition access rules
	 */
	private async validateFieldWriteAccess(
		data: any,
		context: CRUDContext,
		operation: "create" | "update",
		existing?: any,
	): Promise<void> {
		const db = this.getDb(context);
		const fieldAccess = this.getFieldAccessRules();

		await validateFieldsWriteAccess(
			data,
			fieldAccess,
			context,
			{ app: this.app, db },
			this.state.name,
			operation,
			existing,
		);
	}

	/**
	 * Merge user WHERE with access control WHERE
	 * Delegates to extracted mergeWhereWithAccess utility
	 */
	private mergeWhere(
		userWhere?: Where,
		accessWhere?: boolean | AccessWhere,
	): Where | undefined {
		return mergeWhereWithAccess(userWhere, accessWhere);
	}

	/**
	 * Build WHERE clause from WHERE object
	 * Delegates to extracted buildWhereClause function
	 *
	 * @param where - WHERE object
	 * @param useI18n - Whether to use i18n tables
	 * @param customTable - Custom table (optional)
	 * @param context - CRUD context
	 * @param customState - Custom state (optional)
	 * @param i18nCurrentTable - Aliased i18n table for current locale
	 * @param i18nFallbackTable - Aliased i18n table for fallback locale
	 */
	private buildWhereClause(
		where: Where,
		useI18n: boolean = false,
		customTable?: any,
		context?: CRUDContext,
		customState?: CollectionBuilderState,
		i18nCurrentTable?: PgTable | null,
		i18nFallbackTable?: PgTable | null,
	): SQL | undefined {
		return buildWhereClause(where, {
			table: customTable || this.table,
			state: customState || this.state,
			i18nCurrentTable: i18nCurrentTable ?? null,
			i18nFallbackTable: i18nFallbackTable ?? null,
			context,
			app: this.app,
			useI18n,
			db: this.db,
		});
	}

	/**
	 * Build SELECT object for query
	 * Delegates to extracted buildSelectObject function
	 *
	 * @param columns - Column selection
	 * @param extras - Extra fields
	 * @param context - CRUD context
	 * @param i18nCurrentTable - Aliased i18n table for current locale
	 * @param i18nFallbackTable - Aliased i18n table for fallback locale
	 */
	private buildSelectObject(
		columns?: Columns,
		extras?: Extras,
		context?: CRUDContext,
		i18nCurrentTable?: PgTable | null,
		i18nFallbackTable?: PgTable | null,
		table?: PgTable,
		useVersionVirtuals: boolean = false,
	): any {
		const virtualGetter = useVersionVirtuals
			? this.getVirtualsForVersionsWithAliases
			: this.getVirtualsWithAliases;
		const titleGetter = useVersionVirtuals
			? this.getTitleExpressionForVersions
			: this.getTitleExpression;

		return buildSelectObject(columns, extras, context, {
			table: table ?? this.table,
			state: this.state,
			i18nCurrentTable: i18nCurrentTable ?? null,
			i18nFallbackTable: i18nFallbackTable ?? null,
			getVirtualsWithAliases: virtualGetter,
			getTitle: titleGetter,
		});
	}

	/**
	 * Build SELECT object for versions query
	 * Delegates to extracted buildVersionsSelectObject function
	 *
	 * @param context - CRUD context
	 * @param i18nVersionsCurrentTable - Aliased i18n versions table for current locale
	 * @param i18nVersionsFallbackTable - Aliased i18n versions table for fallback locale
	 */
	private buildVersionsSelectObject(
		context: CRUDContext,
		i18nVersionsCurrentTable?: PgTable | null,
		i18nVersionsFallbackTable?: PgTable | null,
	): any {
		if (!this.versionsTable) return {};

		return buildVersionsSelectObject(context, {
			versionsTable: this.versionsTable,
			i18nVersionsCurrentTable: i18nVersionsCurrentTable ?? null,
			i18nVersionsFallbackTable: i18nVersionsFallbackTable ?? null,
			state: this.state,
			getVirtualsForVersionsWithAliases: this.getVirtualsForVersionsWithAliases,
			getTitleForVersions: this.getTitleExpressionForVersions,
		});
	}

	/**
	 * Build order by clauses
	 * Delegates to extracted buildOrderByClauses function
	 *
	 * @param orderBy - Order by specification
	 * @param useI18n - Whether to use i18n tables
	 * @param i18nCurrentTable - Aliased i18n table for current locale
	 * @param i18nFallbackTable - Aliased i18n table for fallback locale
	 */
	private buildOrderByClauses(
		orderBy: OrderBy,
		useI18n: boolean = false,
		i18nCurrentTable?: PgTable | null,
		i18nFallbackTable?: PgTable | null,
		table?: PgTable,
	): SQL[] {
		return buildOrderByClauses(orderBy, {
			table: table ?? this.table,
			state: this.state,
			i18nCurrentTable: i18nCurrentTable ?? null,
			i18nFallbackTable: i18nFallbackTable ?? null,
			useI18n,
		});
	}

	/**
	 * Resolve field key from column
	 * Delegates to shared resolveFieldKey utility
	 */
	private resolveFieldKey(
		state: CollectionBuilderState,
		column: any,
		table?: any,
	): string | undefined {
		return resolveFieldKey(state, column, table);
	}

	/**
	 * Cached nested localization schemas (extracted from field definitions).
	 */
	private _nestedLocalizationSchemas:
		| Record<string, NestedLocalizationSchema>
		| undefined;

	/**
	 * Get nested localization schemas for JSONB fields.
	 * Extracts schemas from field definitions (cached after first call).
	 */
	private getNestedLocalizationSchemas(): Record<
		string,
		NestedLocalizationSchema
	> {
		if (this._nestedLocalizationSchemas === undefined) {
			if (this.state.fieldDefinitions) {
				this._nestedLocalizationSchemas = extractNestedLocalizationSchemas(
					this.state.fieldDefinitions,
				);
			} else {
				this._nestedLocalizationSchemas = {};
			}
		}
		return this._nestedLocalizationSchemas;
	}

	/**
	 * Split localized and non-localized fields.
	 *
	 * Uses field definition schemas to automatically detect which nested fields
	 * are localized. No $i18n wrappers needed from client.
	 *
	 * @param input - Input data
	 */
	private splitLocalizedFields(input: any) {
		const localizedFieldNames = this.getLocalizedFieldNames();
		const nestedSchemas = this.getNestedLocalizationSchemas();

		return splitLocalizedFields(input, localizedFieldNames, nestedSchemas);
	}

	private sanitizeUploadFilename(name: string | undefined): string {
		const basename = (name || "file").split(/[\\/]/).pop() || "file";
		const cleaned = Array.from(basename, (char) => {
			const code = char.charCodeAt(0);
			return code < 32 || code === 127 || '"\\/:*?<>|'.includes(char)
				? "_"
				: char;
		})
			.join("")
			.replace(/\s+/g, " ")
			.trim();
		return cleaned || "file";
	}

	/**
	 * Create upload operation for collections with .upload() configured
	 * Handles file upload to storage and creates a record with metadata
	 */
	private createUpload() {
		return async (
			file: UploadFile,
			context: CRUDContext = {},
			additionalData?: Record<string, any>,
		) => {
			if (!this.state.upload) {
				throw ApiError.notImplemented("Upload");
			}

			if (!this.app?.storage) {
				throw ApiError.internal("Storage not configured");
			}

			const uploadOptions = this.state.upload;

			// Validate file size
			if (uploadOptions.maxSize && file.size > uploadOptions.maxSize) {
				throw ApiError.badRequest(
					`File size ${file.size} exceeds maximum allowed size ${uploadOptions.maxSize}`,
					undefined,
					"upload.tooLarge",
					{ maxSize: uploadOptions.maxSize },
				);
			}

			// Block dangerous file extensions
			const BLOCKED_EXTENSIONS = [
				".php",
				".exe",
				".bat",
				".sh",
				".jsp",
				".asp",
				".aspx",
				".cgi",
				".pl",
				".py",
				".rb",
				".cmd",
				".com",
				".scr",
				".pif",
				".vbs",
				".wsf",
				".msi",
				".dll",
			];
			const filenameParts = (file.name || "").toLowerCase().split(".");
			const extensionParts =
				filenameParts.length > 1 ? filenameParts.slice(1) : filenameParts;
			const blockedExt = extensionParts
				.filter(Boolean)
				.map((part) => `.${part}`)
				.find((part) => BLOCKED_EXTENSIONS.includes(part));
			if (blockedExt) {
				throw ApiError.badRequest(
					`File extension "${blockedExt}" is not allowed`,
					undefined,
					"upload.extensionNotAllowed",
					{ extension: blockedExt },
				);
			}

			// Validate MIME type
			if (uploadOptions.allowedTypes && uploadOptions.allowedTypes.length > 0) {
				const isAllowed = uploadOptions.allowedTypes.some((pattern) => {
					if (pattern.endsWith("/*")) {
						// Wildcard pattern like "image/*"
						const category = pattern.slice(0, -2);
						return file.type.startsWith(`${category}/`);
					}
					return file.type === pattern;
				});

				if (!isAllowed) {
					throw ApiError.badRequest(
						`File type "${file.type}" is not allowed. Allowed types: ${uploadOptions.allowedTypes.join(", ")}`,
						undefined,
						"upload.invalidType",
						{ type: file.type },
					);
				}
			}

			// Generate unique storage key
			const sanitizedFilename = this.sanitizeUploadFilename(file.name);
			const key = crypto.randomUUID();
			const visibility: StorageVisibility =
				uploadOptions.visibility || "public";

			// Upload file to storage using streaming when available
			// Normalize MIME type (remove charset etc)
			const mimeType = file.type.split(";")[0]?.trim() || file.type;
			let stored = false;

			try {
				// Streaming is more memory-efficient for large files
				if (file.stream) {
					await this.app.storage.upload(key, file.stream(), {
						contentType: mimeType,
					});
				} else if (file.arrayBuffer) {
					// Fallback to buffer-based upload for files without stream support
					const buffer = await file.arrayBuffer();
					await this.app.storage.upload(key, new Uint8Array(buffer), {
						contentType: mimeType,
					});
				} else {
					throw ApiError.badRequest(
						"Uploaded file must provide a stream or arrayBuffer reader.",
						undefined,
						"upload.invalidFile",
					);
				}
				stored = true;

				// Create record using the existing create method
				const createFn = this.createCreate();
				return await createFn(
					{
						key,
						filename: sanitizedFilename,
						mimeType,
						size: file.size,
						visibility,
						...additionalData,
					} as Record<string, unknown>,
					context,
				);
			} catch (error) {
				if (stored) {
					await this.app.storage.delete(key).catch(() => {});
				}
				throw error;
			}
		};
	}

	/**
	 * Create uploadMany operation for collections with .upload() configured
	 * Handles multiple file uploads
	 */
	private createUploadMany() {
		return async (
			files: UploadFile[],
			context: CRUDContext = {},
			additionalData?: Record<string, any>,
		) => {
			if (!this.state.upload) {
				throw ApiError.notImplemented("Upload");
			}

			const uploadFn = this.createUpload();
			const results: any[] = [];

			for (const file of files) {
				const record = await uploadFn(file, context, additionalData);
				results.push(record);
			}

			return results;
		};
	}
}
