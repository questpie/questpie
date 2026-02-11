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
} from "drizzle-orm";
import { alias, type PgTable } from "drizzle-orm/pg-core";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import { buildWhereClause } from "#questpie/server/collection/crud/query-builders/index.js";
import {
	processNestedRelations,
	separateNestedRelations,
} from "#questpie/server/collection/crud/relation-mutations/nested-operations.js";
import {
	resolveBelongsToRelation,
	resolveHasManyRelation,
	resolveHasManyWithAggregation,
	resolveManyToManyRelation,
} from "#questpie/server/collection/crud/relation-resolvers/index.js";
import { resolveFieldKey } from "#questpie/server/collection/crud/shared/field-resolver.js";
import {
	appendRealtimeChange,
	executeAccessRule,
	extractNestedLocalizationSchemas,
	getDb,
	getRestrictedReadFields,
	mergeI18nRows,
	normalizeContext,
	notifyRealtimeChange,
	splitLocalizedFields,
	withTransaction,
} from "#questpie/server/collection/crud/shared/index.js";
import type {
	Columns,
	CRUDContext,
	Where,
	With,
} from "#questpie/server/collection/crud/types.js";
import { createVersionRecord } from "#questpie/server/collection/crud/versioning/index.js";
import { ApiError } from "#questpie/server/errors/index.js";
import {
	applyFieldInputHooks,
	applyFieldOutputHooks,
} from "#questpie/server/fields/runtime.js";
import type { FieldDefinitionAccess } from "#questpie/server/fields/types.js";
import type {
	GlobalAccessContext,
	GlobalBuilderState,
	GlobalHookContext,
	GlobalHookFunction,
} from "#questpie/server/global/builder/types.js";
import { DEFAULT_LOCALE } from "#questpie/shared/constants.js";
import type {
	GlobalCRUD,
	GlobalFindVersionsOptions,
	GlobalGetOptions,
	GlobalRevertVersionOptions,
	GlobalUpdateOptions,
	GlobalVersionRecord,
} from "./types.js";

export class GlobalCRUDGenerator<TState extends GlobalBuilderState> {
	constructor(
		private state: TState,
		private table: PgTable,
		private i18nTable: PgTable | null,
		private versionsTable: PgTable | null,
		private i18nVersionsTable: PgTable | null,
		private db: any,
		private getVirtuals?: (context: any) => any,
		private getVirtualsForVersions?: (context: any) => any,
		private cms?: any,
	) {}

	generate(): GlobalCRUD {
		const crud: GlobalCRUD = {
			get: this.wrapGetWithCMSContext(this.createGet()),
			update: this.wrapUpdateWithCMSContext(this.createUpdate()),
			findVersions: this.wrapWithCMSContext(this.createFindVersions()),
			revertToVersion: this.wrapWithCMSContext(this.createRevertToVersion()),
		};
		return crud;
	}

	private getDb(context?: CRUDContext) {
		return getDb(this.db, context);
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

	private getFieldAccessRules():
		| Record<string, FieldDefinitionAccess>
		| undefined {
		// Source field access from global-level .access({ fields: {...} })
		const globalAccess = this.state.access as
			| { fields?: Record<string, FieldDefinitionAccess> }
			| undefined;
		return globalAccess?.fields;
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

	/**
	 * Append a realtime change event
	 * Delegates to shared appendRealtimeChange utility
	 */
	private async appendRealtimeChange(
		params: {
			operation: "create" | "update" | "delete" | "bulk_update" | "bulk_delete";
			recordId?: string | null;
			payload?: Record<string, unknown>;
		},
		context: CRUDContext,
		db: any,
	) {
		return appendRealtimeChange(
			params,
			context,
			db,
			this.cms,
			this.state.name,
			"global",
		);
	}

	/**
	 * Notify realtime subscribers of a change
	 * Delegates to shared notifyRealtimeChange utility
	 */
	private async notifyRealtimeChange(change: unknown) {
		return notifyRealtimeChange(change, this.cms);
	}

	/**
	 * Wrapper for get() method: (options?, context?)
	 */
	private wrapGetWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return (...args: TArgs) => {
			let context: CRUDContext | undefined;

			if (args.length > 0) {
				const lastArg = args[args.length - 1];
				const isCRUDContext =
					lastArg &&
					typeof lastArg === "object" &&
					("session" in lastArg ||
						"locale" in lastArg ||
						"accessMode" in lastArg ||
						"db" in lastArg ||
						"defaultLocale" in lastArg);

				if (isCRUDContext) {
					context = lastArg as CRUDContext;
				}
			}

			return fn(...args);
		};
	}

	/**
	 * Wrapper for update() method: (data, context?, options?)
	 */
	private wrapUpdateWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return fn;
	}

	/**
	 * Generic wrapper for other methods where context is always last
	 */
	private wrapWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return fn;
	}

	private buildSelectQuery(
		db: any,
		context: CRUDContext,
		columns?: Columns<TState["fields"]>,
	) {
		// Determine i18n setup
		// If i18n table exists, we MUST use i18n queries to properly fetch localized fields
		const useI18n = !!this.i18nTable;
		const needsFallback =
			useI18n &&
			context.localeFallback !== false &&
			context.locale !== context.defaultLocale;
		const i18nCurrentTable = useI18n
			? alias(this.i18nTable!, "i18n_current")
			: null;
		const i18nFallbackTable = needsFallback
			? alias(this.i18nTable!, "i18n_fallback")
			: null;

		const selectObj = this.buildSelectObject(
			context,
			columns,
			i18nCurrentTable,
			i18nFallbackTable,
		);
		let query = db.select(selectObj).from(this.table);

		if (useI18n && i18nCurrentTable) {
			query = query.leftJoin(
				i18nCurrentTable,
				and(
					eq((i18nCurrentTable as any).parentId, (this.table as any).id),
					eq((i18nCurrentTable as any).locale, context.locale!),
				),
			);

			if (needsFallback && i18nFallbackTable) {
				query = query.leftJoin(
					i18nFallbackTable,
					and(
						eq((i18nFallbackTable as any).parentId, (this.table as any).id),
						eq((i18nFallbackTable as any).locale, context.defaultLocale!),
					),
				);
			}
		}

		return { query, useI18n, needsFallback };
	}

	/**
	 * Resolve the scope ID from context using the scoped resolver
	 */
	private resolveScopeId(context: CRUDContext): string | null | undefined {
		const scopeResolver = this.state.options.scoped;
		if (!scopeResolver) return undefined;
		return scopeResolver(context as any);
	}

	private async getCurrentRow(db: any, context?: CRUDContext) {
		const scopeId = context ? this.resolveScopeId(context) : undefined;
		const isScoped = this.state.options.scoped !== undefined;

		let query = db.select().from(this.table);

		// Filter by scope if this is a scoped global
		if (isScoped) {
			if (scopeId) {
				query = query.where(eq((this.table as any).scopeId, scopeId));
			} else {
				// null scope - global instance
				query = query.where(sql`${(this.table as any).scopeId} IS NULL`);
			}
		}

		const rows = await query.limit(1);
		return rows[0] || null;
	}

	private createGet() {
		return async (
			options: GlobalGetOptions = {},
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			const isScoped = this.state.options.scoped !== undefined;
			const scopeId = isScoped ? this.resolveScopeId(normalized) : undefined;

			// Enforce access control
			const canRead = await this.enforceAccessControl(
				"read",
				normalized,
				null,
				options,
			);
			if (!canRead) {
				throw ApiError.forbidden({
					operation: "read",
					resource: this.state.name,
					reason: "User does not have permission to read global settings",
				});
			}

			// Hooks
			await this.executeHooks(
				this.state.hooks?.beforeRead,
				this.createHookContext({ data: null, context: normalized, db }),
			);

			const { query, useI18n, needsFallback } = this.buildSelectQuery(
				db,
				normalized,
				options.columns,
			);

			// Apply scope filter if this is a scoped global
			let scopedQuery = query;
			if (isScoped) {
				if (scopeId) {
					scopedQuery = query.where(eq((this.table as any).scopeId, scopeId));
				} else {
					scopedQuery = query.where(
						sql`${(this.table as any).scopeId} IS NULL`,
					);
				}
			}

			let rows = await scopedQuery.limit(1);

			// Application-side i18n merge
			if (useI18n && rows.length > 0 && this.state.localized.length > 0) {
				rows = mergeI18nRows(rows, {
					localizedFields: this.state.localized,
					hasFallback: needsFallback,
				});
			}

			let row = rows[0] || null;

			if (!row) {
				row = await withTransaction(db, async (tx: any) => {
					// Auto-create with scope_id if scoped
					const insertValues: Record<string, any> = {};
					if (isScoped) {
						insertValues.scopeId = scopeId ?? null;
					}

					const [inserted] = await tx
						.insert(this.table)
						.values(insertValues)
						.returning();
					if (!inserted) {
						throw ApiError.internal("Failed to auto-create global record");
					}

					await this.createVersion(tx, inserted, "create", normalized);

					const {
						query: createdQuery,
						useI18n: createdUseI18n,
						needsFallback: createdNeedsFallback,
					} = this.buildSelectQuery(tx, normalized, options.columns);
					let createdRows = await createdQuery
						.where(eq((this.table as any).id, inserted.id))
						.limit(1);

					// Application-side i18n merge
					if (
						createdUseI18n &&
						createdRows.length > 0 &&
						this.state.localized.length > 0
					) {
						createdRows = mergeI18nRows(createdRows, {
							localizedFields: this.state.localized,
							hasFallback: createdNeedsFallback,
						});
					}

					return createdRows[0] || inserted;
				});
			}

			if (row && options.with && this.cms) {
				await this.resolveRelations([row], options.with, normalized);
			}

			// Filter fields based on field-level read access
			if (row) {
				await this.filterFieldsForRead(row, normalized);
				await this.runFieldOutputHooks(row, "read", normalized, db);
			}

			// Hooks
			if (row && this.state.hooks?.afterRead) {
				await this.executeHooks(
					this.state.hooks.afterRead,
					this.createHookContext({ data: row, context: normalized, db }),
				);
			}

			return row;
		};
	}

	/**
	 * Separate nested relation operations from regular fields
	 * Delegates to extracted separateNestedRelations utility
	 */
	private separateNestedRelationsInternal(input: any): {
		regularFields: any;
		nestedRelations: Record<string, any>;
	} {
		const relationNames = this.state.relations
			? new Set(Object.keys(this.state.relations))
			: new Set<string>();
		return separateNestedRelations(input, relationNames);
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
		if (!this.cms || !this.state.relations) return;
		await processNestedRelations({
			parentRecord,
			nestedRelations,
			relations: this.state.relations,
			cms: this.cms,
			context,
			tx,
			resolveFieldKey: (state, column, table) =>
				this.resolveFieldKey(state as any, column, table),
		});
	}

	private createUpdate() {
		return async (
			data: any,
			context: CRUDContext = {},
			options: GlobalUpdateOptions = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			const isScoped = this.state.options.scoped !== undefined;
			const scopeId = isScoped ? this.resolveScopeId(normalized) : undefined;
			const existing = await this.getCurrentRow(db, normalized);

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				data,
			);
			if (!canUpdate)
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to update global settings",
				});

			await this.executeHooks(
				this.state.hooks?.beforeUpdate,
				this.createHookContext({
					data: existing,
					input: data,
					context: normalized,
					db,
				}),
			);

			// Separate nested relation operations from regular fields
			let { regularFields, nestedRelations } =
				this.separateNestedRelationsInternal(data);

			// Validate field-level write access
			await this.validateFieldWriteAccess(
				regularFields,
				normalized,
				existing ? "update" : "create",
				existing,
			);

			regularFields = await this.runFieldInputHooks(
				regularFields,
				existing ? "update" : "create",
				normalized,
				db,
				existing,
			);

			await this.executeHooks(
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: existing,
					input: regularFields,
					context: normalized,
					db,
				}),
			);

			let changeEvent: any = null;
			const updatedRecord = await withTransaction(db, async (tx: any) => {
				const { localized, nonLocalized } =
					this.splitLocalizedFields(regularFields);

				let updatedId = existing?.id;

				if (existing) {
					if (Object.keys(nonLocalized).length > 0) {
						await tx
							.update(this.table)
							.set({
								...nonLocalized,
								...(this.state.options.timestamps !== false
									? { updatedAt: new Date() }
									: {}),
							})
							.where(eq((this.table as any).id, existing.id));
					}
				} else {
					// Include scope_id when creating new record for scoped globals
					const insertValues = {
						...nonLocalized,
						...(isScoped ? { scopeId: scopeId ?? null } : {}),
					};
					const [inserted] = await tx
						.insert(this.table)
						.values(insertValues)
						.returning();
					updatedId = inserted?.id;
				}

				if (
					this.i18nTable &&
					normalized.locale &&
					Object.keys(localized).length > 0
				) {
					await tx
						.insert(this.i18nTable)
						.values({
							parentId: updatedId,
							locale: normalized.locale,
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

				const baseRows = updatedId
					? await tx
							.select()
							.from(this.table)
							.where(eq((this.table as any).id, updatedId))
							.limit(1)
					: [];
				const baseRecord = baseRows[0] || null;

				let updatedRecord = baseRecord;
				if (updatedId) {
					const {
						query: refreshQuery,
						useI18n: refreshUseI18n,
						needsFallback: refreshNeedsFallback,
					} = this.buildSelectQuery(tx, normalized);
					let refreshedRows = await refreshQuery
						.where(eq((this.table as any).id, updatedId))
						.limit(1);

					// Application-side i18n merge
					if (
						refreshUseI18n &&
						refreshedRows.length > 0 &&
						this.state.localized.length > 0
					) {
						refreshedRows = mergeI18nRows(refreshedRows, {
							localizedFields: this.state.localized,
							hasFallback: refreshNeedsFallback,
						});
					}
					updatedRecord = refreshedRows[0] || baseRecord;
				}

				if (!baseRecord) {
					throw ApiError.internal("Global record not found after update");
				}

				// Process nested relation operations (create, connect, connectOrCreate)
				if (Object.keys(nestedRelations).length > 0) {
					await this.processNestedRelationsInternal(
						baseRecord,
						nestedRelations,
						normalized,
						tx,
					);
				}

				await this.createVersion(
					tx,
					baseRecord,
					existing ? "update" : "create",
					normalized,
				);

				await this.executeHooks(
					this.state.hooks?.afterUpdate,
					this.createHookContext({
						data: updatedRecord,
						input: data,
						context: normalized,
						db: tx,
					}),
				);
				await this.executeHooks(
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: updatedRecord,
						input: data,
						context: normalized,
						db: tx,
					}),
				);

				changeEvent = await this.appendRealtimeChange(
					{
						operation: existing ? "update" : "create",
						recordId: baseRecord.id,
					},
					normalized,
					tx,
				);

				return updatedRecord;
			});

			// Resolve relations if requested
			if (updatedRecord && options.with && this.cms) {
				await this.resolveRelations([updatedRecord], options.with, normalized);
			}

			if (updatedRecord) {
				await this.runFieldOutputHooks(
					updatedRecord,
					existing ? "update" : "create",
					normalized,
					db,
					existing ?? undefined,
				);
			}

			await this.notifyRealtimeChange(changeEvent);
			return updatedRecord;
		};
	}

	private createFindVersions() {
		return async (
			options: GlobalFindVersionsOptions = {},
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			if (!this.versionsTable) return [];

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

			const parentId = options.id ?? (await this.getCurrentRow(db))?.id;
			if (!parentId) return [];

			let query = db
				.select(this.buildVersionsSelectObject(normalized))
				.from(this.versionsTable)
				.where(eq((this.versionsTable as any).id, parentId))
				.orderBy(sql`${(this.versionsTable as any).versionNumber} ASC`);

			if (this.i18nVersionsTable && normalized.locale) {
				query = query.leftJoin(
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
				);
			}

			if (options.limit) query = query.limit(options.limit);
			if (options.offset) query = query.offset(options.offset);

			return (await query) as GlobalVersionRecord[];
		};
	}

	private createRevertToVersion() {
		return async (
			options: GlobalRevertVersionOptions,
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			if (!this.versionsTable) throw ApiError.notImplemented("Versioning");

			const hasVersionId = typeof options.versionId === "string";
			const hasVersion = typeof options.version === "number";

			if (!hasVersionId && !hasVersion) {
				throw ApiError.badRequest("Version or versionId required");
			}

			const parentId = options.id ?? (await this.getCurrentRow(db))?.id;
			if (!parentId) {
				throw ApiError.notFound("Global record", "");
			}

			const versionRows = await db
				.select()
				.from(this.versionsTable)
				.where(
					hasVersionId
						? and(
								eq((this.versionsTable as any).id, parentId),
								eq((this.versionsTable as any).versionId, options.versionId),
							)
						: and(
								eq((this.versionsTable as any).id, parentId),
								eq((this.versionsTable as any).versionNumber, options.version),
							),
				)
				.limit(1);
			const version = versionRows[0];

			if (!version)
				throw ApiError.notFound(
					"Version",
					options.versionId || String(options.version),
				);

			const existing = await this.getCurrentRow(db);
			if (!existing) throw ApiError.notFound("Global record", "");

			const nonLocalized: Record<string, any> = {};
			for (const [name] of Object.entries(this.state.fields)) {
				if (this.state.localized.includes(name as any)) continue;
				nonLocalized[name] = version[name];
			}

			const localizedForContext: Record<string, any> = {};
			if (this.i18nVersionsTable && normalized.locale) {
				const localeRows = await db
					.select()
					.from(this.i18nVersionsTable)
					.where(
						and(
							eq((this.i18nVersionsTable as any).parentId, parentId),
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
			const restoreWithFieldHooks = await this.runFieldInputHooks(
				restoreData,
				"update",
				normalized,
				db,
				existing,
			);
			const { localized: restoreLocalized, nonLocalized: restoreNonLocalized } =
				this.splitLocalizedFields(restoreWithFieldHooks);

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				restoreWithFieldHooks,
			);
			if (!canUpdate)
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to revert to this version",
				});

			await this.executeHooks(
				this.state.hooks?.beforeUpdate,
				this.createHookContext({
					data: existing,
					input: restoreWithFieldHooks,
					context: normalized,
					db,
				}),
			);

			await this.executeHooks(
				this.state.hooks?.beforeChange,
				this.createHookContext({
					data: existing,
					input: restoreWithFieldHooks,
					context: normalized,
					db,
				}),
			);

			return withTransaction(db, async (tx: any) => {
				if (Object.keys(restoreNonLocalized).length > 0) {
					await tx
						.update(this.table)
						.set({
							...restoreNonLocalized,
							...(this.state.options.timestamps !== false
								? { updatedAt: new Date() }
								: {}),
						})
						.where(eq((this.table as any).id, parentId));
				}

				if (this.i18nTable && this.i18nVersionsTable) {
					await tx
						.delete(this.i18nTable)
						.where(eq((this.i18nTable as any).parentId, parentId));

					const localeRows = await tx
						.select()
						.from(this.i18nVersionsTable)
						.where(
							and(
								eq((this.i18nVersionsTable as any).parentId, parentId),
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
								parentId,
								locale,
								...localizedFields,
							};
						});

						await tx.insert(this.i18nTable).values(insertRows);
					}

					if (normalized.locale && Object.keys(restoreLocalized).length > 0) {
						await tx
							.insert(this.i18nTable)
							.values({
								parentId,
								locale: normalized.locale,
								...restoreLocalized,
							})
							.onConflictDoUpdate({
								target: [
									(this.i18nTable as any).parentId,
									(this.i18nTable as any).locale,
								],
								set: restoreLocalized,
							});
					}
				}

				const baseRows = await tx
					.select()
					.from(this.table)
					.where(eq((this.table as any).id, parentId))
					.limit(1);
				const baseRecord = baseRows[0] || null;

				const {
					query: refreshQuery,
					useI18n: refreshUseI18n,
					needsFallback: refreshNeedsFallback,
				} = this.buildSelectQuery(tx, normalized);
				let refreshedRows = await refreshQuery
					.where(eq((this.table as any).id, parentId))
					.limit(1);

				// Application-side i18n merge
				if (
					refreshUseI18n &&
					refreshedRows.length > 0 &&
					this.state.localized.length > 0
				) {
					refreshedRows = mergeI18nRows(refreshedRows, {
						localizedFields: this.state.localized,
						hasFallback: refreshNeedsFallback,
					});
				}
				const updatedRecord = refreshedRows[0] || baseRecord;

				if (!baseRecord) {
					throw ApiError.internal("Global record not found after revert");
				}

				await this.createVersion(tx, baseRecord, "update", normalized);

				await this.executeHooks(
					this.state.hooks?.afterUpdate,
					this.createHookContext({
						data: updatedRecord,
						input: restoreWithFieldHooks,
						context: normalized,
						db: tx,
					}),
				);
				await this.executeHooks(
					this.state.hooks?.afterChange,
					this.createHookContext({
						data: updatedRecord,
						input: restoreWithFieldHooks,
						context: normalized,
						db: tx,
					}),
				);

				if (updatedRecord) {
					await this.runFieldOutputHooks(
						updatedRecord,
						"update",
						normalized,
						tx,
						existing,
					);
				}

				return updatedRecord;
			});
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
	) {
		if (!this.versionsTable) return;
		await createVersionRecord({
			tx,
			row,
			operation,
			versionsTable: this.versionsTable,
			i18nVersionsTable: this.i18nVersionsTable,
			i18nTable: this.i18nTable,
			options: this.state.options,
			context,
		});
	}

	private buildSelectObject(
		context: CRUDContext,
		columns?: Columns<TState["fields"]>,
		i18nCurrentTable?: PgTable | null,
		i18nFallbackTable?: PgTable | null,
	) {
		const select: any = {
			id: (this.table as any).id,
		};

		// If columns is specified, use partial selection
		const includeAllFields = !columns;
		const hasFallback = !!i18nFallbackTable;

		for (const [name, _column] of Object.entries(this.state.fields)) {
			// Skip if columns filter is active and this field is not selected
			if (columns && !columns[name]) continue;

			const isLocalizedField = this.state.localized.includes(name as any);

			if (isLocalizedField && i18nCurrentTable && context.locale) {
				const i18nCurrentTbl = i18nCurrentTable as any;

				// Check if column exists in ORIGINAL i18n table (aliased tables don't support property checks)
				const columnExistsInI18n =
					i18nCurrentTable && (i18nCurrentTable as any)[name];

				if (columnExistsInI18n) {
					// Current locale value (prefixed)
					select[`_i18n_${name}`] = i18nCurrentTbl[name];

					// Fallback locale value (prefixed) - only if fallback is enabled
					if (hasFallback && i18nFallbackTable) {
						const i18nFallbackTbl = i18nFallbackTable as any;
						select[`_i18n_fallback_${name}`] = i18nFallbackTbl[name];
					}
				} else {
					// JSONB localized field or column doesn't exist in i18n table
					select[name] = (this.table as any)[name];
				}
			} else {
				select[name] = (this.table as any)[name];
			}
		}

		const virtuals = this.getVirtuals
			? this.getVirtuals(context)
			: this.state.virtuals;
		for (const [name, sqlExpr] of Object.entries(virtuals)) {
			if (columns && !columns[name]) continue;
			select[name] = sqlExpr;
		}

		if (this.state.options.timestamps !== false) {
			if (includeAllFields || columns?.createdAt) {
				select.createdAt = (this.table as any).createdAt;
			}
			if (includeAllFields || columns?.updatedAt) {
				select.updatedAt = (this.table as any).updatedAt;
			}
		}

		return select;
	}

	private buildVersionsSelectObject(context: CRUDContext) {
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
		const defaultLocale = context?.defaultLocale || DEFAULT_LOCALE;

		for (const [name, _column] of Object.entries(this.state.fields)) {
			const isLocalizedField = this.state.localized.includes(name as any);

			if (isLocalizedField && this.i18nVersionsTable && context.locale) {
				const i18nVersionsTable = this.i18nVersionsTable as any;

				// Check if column exists in i18n versions table
				const columnExistsInI18n = (this.i18nVersionsTable as any)[name];

				if (columnExistsInI18n) {
					if (context.localeFallback === false) {
						select[name] = i18nVersionsTable[name];
					} else {
						select[name] = sql`COALESCE(
							${i18nVersionsTable[name]},
							(SELECT ${i18nVersionsTable[name]} FROM ${this.i18nVersionsTable}
							 WHERE ${i18nVersionsTable.parentId} = ${versionsTable.id}
							 AND ${i18nVersionsTable.versionNumber} = ${versionsTable.versionNumber}
							 AND ${i18nVersionsTable.locale} = ${defaultLocale} LIMIT 1)
						)`;
					}
				} else {
					// JSONB localized field or column doesn't exist in i18n versions table
					select[name] = versionsTable[name];
				}
			} else {
				select[name] = versionsTable[name];
			}
		}

		const versionVirtuals = this.getVirtualsForVersions
			? this.getVirtualsForVersions(context)
			: {};
		for (const [name, sqlExpr] of Object.entries(versionVirtuals)) {
			select[name] = sqlExpr;
		}

		if (this.state.options.timestamps !== false) {
			select.createdAt = versionsTable.createdAt;
			select.updatedAt = versionsTable.updatedAt;
		}

		return select;
	}

	/**
	 * Split input data into localized and non-localized fields.
	 * Uses field definition schemas to determine which nested fields are localized.
	 */
	private splitLocalizedFields(input: any) {
		// Extract nested localization schemas from field definitions
		const nestedSchemas = this.state.fieldDefinitions
			? extractNestedLocalizationSchemas(this.state.fieldDefinitions)
			: {};

		return splitLocalizedFields(input, this.state.localized, nestedSchemas);
	}

	/**
	 * Create hook context with full CMS access
	 */
	private createHookContext(params: {
		data: any;
		input?: any;
		context: CRUDContext;
		db: any;
	}): GlobalHookContext {
		const normalized = this.normalizeContext(params.context);
		return {
			data: params.data,
			input: params.input,
			app: this.cms as any,
			session: normalized.session,
			locale: normalized.locale,
			accessMode: normalized.accessMode,
			db: params.db,
		};
	}

	private async executeHooks(
		hooks: GlobalHookFunction | GlobalHookFunction[] | undefined,
		ctx: GlobalHookContext,
	) {
		if (!hooks) return;
		const hookArray = Array.isArray(hooks) ? hooks : [hooks];
		for (const hook of hookArray) {
			await hook(ctx);
		}
	}

	/**
	 * Enforce access control
	 * Delegates to extracted executeAccessRule utility
	 * Falls back to CMS defaultAccess if global doesn't define its own rules
	 * Note: Globals only return boolean (no AccessWhere support)
	 */
	private async enforceAccessControl(
		operation: "read" | "update",
		context: CRUDContext,
		row: any,
		input?: any,
	): Promise<boolean> {
		const normalized = this.normalizeContext(context);
		const db = this.getDb(normalized);

		if (normalized.accessMode === "system") return true;

		// Map global operation names to collection access names
		const accessOperation = operation === "update" ? "update" : "read";

		// Use global's access rule, or fall back to CMS defaultAccess
		const accessRule =
			this.state.access?.[operation] ??
			this.cms?.defaultAccess?.[accessOperation];
		const result = await executeAccessRule(accessRule, {
			cms: this.cms,
			db,
			session: normalized.session,
			locale: normalized.locale,
			row,
			input,
		});
		// Globals only support boolean access rules (not AccessWhere)
		return result === true;
	}

	/**
	 * Get fields the user can read based on field-level access control
	 */
	private getReadableFields(context: CRUDContext): Set<string> {
		const normalized = this.normalizeContext(context);
		const readableFields = new Set<string>();

		// System mode can read all fields
		if (normalized.accessMode === "system") {
			return new Set([
				...Object.keys(this.state.fields),
				...Object.keys(this.state.virtuals),
				"id",
				"createdAt",
				"updatedAt",
			]);
		}

		const fieldAccess = this.getFieldAccessRules();
		if (!fieldAccess) {
			// No field-level access rules - all fields readable
			return new Set([
				...Object.keys(this.state.fields),
				...Object.keys(this.state.virtuals),
				"id",
				"createdAt",
				"updatedAt",
			]);
		}

		// Check each field's read access
		const allFields = [
			...Object.keys(this.state.fields),
			...Object.keys(this.state.virtuals),
		];

		for (const fieldName of allFields) {
			const access = fieldAccess[fieldName];
			if (!access || access.read === undefined) {
				// No access rule for this field - allow read
				readableFields.add(fieldName);
				continue;
			}

			const readRule = access.read;

			// Boolean rule
			if (typeof readRule === "boolean") {
				if (readRule) {
					readableFields.add(fieldName);
				}
				continue;
			}

			// Function rule - we can't evaluate async here, so we allow it
			// The actual filtering will happen in filterFieldsForRead
			if (typeof readRule === "function") {
				readableFields.add(fieldName);
			}
		}

		// Always include meta fields
		readableFields.add("id");
		if (this.state.options.timestamps !== false) {
			readableFields.add("createdAt");
			readableFields.add("updatedAt");
		}

		return readableFields;
	}

	/**
	 * Filter fields from result based on field-level read access
	 * Delegates to extracted getRestrictedReadFields utility
	 */
	private async filterFieldsForRead(
		result: any,
		context: CRUDContext,
	): Promise<void> {
		if (!result) return;

		const db = this.getDb(context);
		const fieldAccess = this.getFieldAccessRules();
		const fieldsToRemove = await getRestrictedReadFields(result, context, {
			cms: this.cms,
			db,
			fieldAccess,
		});

		// Remove restricted fields
		for (const fieldName of fieldsToRemove) {
			delete result[fieldName];
		}
	}

	/**
	 * Check if user can write to a specific field
	 */
	private async canWriteField(
		fieldName: string,
		context: CRUDContext,
		operation: "create" | "update",
		row?: any,
	): Promise<boolean> {
		const fieldAccess = this.getFieldAccessRules();
		const access = fieldAccess?.[fieldName];
		if (!access) return true;

		const rule = operation === "create" ? access.create : access.update;
		if (rule === undefined || rule === true) return true;
		if (rule === false) return false;
		if (typeof rule === "function") {
			const req =
				(context as any).req ??
				(context as any).request ??
				(typeof Request !== "undefined"
					? new Request("http://questpie.local")
					: ({} as Request));
			return (
				(await rule({
					req,
					user: (context.session as any)?.user,
					doc: row,
					operation,
				})) === true
			);
		}

		return true;
	}

	/**
	 * Validate write access for all fields in input data
	 */
	private async validateFieldWriteAccess(
		data: any,
		context: CRUDContext,
		operation: "create" | "update",
		existing?: any,
	): Promise<void> {
		const normalized = this.normalizeContext(context);

		// System mode bypasses field access control
		if (normalized.accessMode === "system") return;

		const fieldAccess = this.getFieldAccessRules();
		if (!fieldAccess) return; // No field-level access rules

		// Check each field in the input
		for (const fieldName of Object.keys(data)) {
			// Skip meta fields
			if (
				fieldName === "id" ||
				fieldName === "createdAt" ||
				fieldName === "updatedAt"
			) {
				continue;
			}

			const canWrite = await this.canWriteField(
				fieldName,
				context,
				operation,
				existing,
			);
			if (!canWrite) {
				throw ApiError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: `Cannot write field '${fieldName}': access denied`,
					fieldPath: fieldName,
				});
			}
		}
	}

	/**
	 * Resolve relations recursively (mirrors collection relation loading)
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

			if (relation.fields && relation.fields.length > 0) {
				const sourceField = relation.fields[0];
				const targetFieldName = relation.references[0];

				const sourceColName =
					this.resolveFieldKey(this.state, sourceField, this.table) ??
					sourceField.name;

				const sourceIds = new Set(
					rows
						.map((r) => r[sourceColName])
						.filter((id) => id !== null && id !== undefined),
				);
				if (sourceIds.size === 0) continue;

				const nestedOptions =
					typeof relationOptions === "object" ? relationOptions : {};
				const { docs: relatedRows } = await relatedCrud.find(
					{
						...nestedOptions,
						where: {
							...nestedOptions.where,
							[targetFieldName]: { in: Array.from(sourceIds) },
						},
					},
					context,
				);

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
			} else if (relation.type === "many" && !relation.fields) {
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

				const parentIds = new Set(
					rows
						.map((r) => r[primaryKeyField])
						.filter((id) => id !== null && id !== undefined),
				);
				if (parentIds.size === 0) continue;

				const nestedOptions =
					typeof relationOptions === "object" ? relationOptions : {};

				if (nestedOptions._count || nestedOptions._aggregate) {
					const relatedTable = relatedCrud["~internalRelatedTable"];
					const foreignKeyCol = relatedTable[foreignKeyField];

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

					const whereConditions = [
						inArray(foreignKeyCol, Array.from(parentIds)),
					];

					if (nestedOptions.where) {
						const additionalWhere = this.buildWhereClauseInternal(
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

					const aggregateResults = await db
						.select(selectClause)
						.from(relatedTable)
						.where(and(...whereConditions))
						.groupBy(foreignKeyCol);

					const aggregateMap = new Map();
					for (const result of aggregateResults) {
						const parentId = result[foreignKeyField];
						const aggData: Record<string, any> = {};

						if (result._count !== undefined) {
							aggData._count = Number(result._count);
						}

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

					for (const row of rows) {
						const parentId = row[primaryKeyField];
						row[relationName] = aggregateMap.get(parentId) || { _count: 0 };
					}
				} else {
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

					const { docs: relatedRows } = await relatedCrud.find(
						{
							...queryOptions,
							where: relatedWhere,
						},
						context,
					);

					const relatedMap = new Map<any, any[]>();
					for (const relatedRow of relatedRows) {
						const parentId = relatedRow[foreignKeyField];
						if (!relatedMap.has(parentId)) {
							relatedMap.set(parentId, []);
						}
						relatedMap.get(parentId)?.push(relatedRow);
					}

					for (const row of rows) {
						const parentId = row[primaryKeyField];
						row[relationName] = relatedMap.get(parentId) || [];
					}
				}
			} else if (relation.type === "manyToMany" && relation.through) {
				const sourceKey = relation.sourceKey || "id";
				const targetKey = relation.targetKey || "id";
				const sourceField = relation.sourceField;
				const targetField = relation.targetField;

				if (!sourceField || !targetField) continue;

				const junctionCrud = this.cms.api.collections[relation.through];

				const sourceIds = new Set(
					rows
						.map((r) => r[sourceKey])
						.filter((id) => id !== null && id !== undefined),
				);
				if (sourceIds.size === 0) continue;

				const { docs: junctionRows } = await junctionCrud.find(
					{
						where: { [sourceField]: { in: Array.from(sourceIds) } },
					},
					context,
				);

				if (!junctionRows.length) {
					for (const row of rows) {
						row[relationName] = [];
					}
					continue;
				}

				const targetIds = [
					...new Set(
						junctionRows
							.map((j: any) => j[targetField])
							.filter((id: any) => id !== null && id !== undefined),
					),
				];

				if (!targetIds.length) {
					for (const row of rows) {
						row[relationName] = [];
					}
					continue;
				}

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

				const junctionMap = new Map<any, any[]>();
				for (const j of junctionRows) {
					const sid = j[sourceField];
					if (!junctionMap.has(sid)) {
						junctionMap.set(sid, []);
					}
					junctionMap.get(sid)?.push(j[targetField]);
				}

				const relatedMap = new Map();
				for (const r of relatedRows) {
					relatedMap.set(r[targetKey], r);
				}

				for (const row of rows) {
					const sourceId = row[sourceKey];
					const relatedIds = junctionMap.get(sourceId) || [];
					row[relationName] = relatedIds
						.map((tid) => relatedMap.get(tid))
						.filter((r) => r !== undefined);
				}
			}
		}
	}

	private resolveFieldKey(
		state: GlobalBuilderState,
		column: any,
		table?: any,
	): string | undefined {
		if (typeof column === "string") return column;

		// Column can be either a built column (with .name) or a builder (with .config.name)
		const columnName = column?.name ?? column?.config?.name;
		if (!columnName) return undefined;

		for (const [key, value] of Object.entries(state.fields)) {
			// Check both .name and .config.name for compatibility
			const valueName = (value as any)?.name ?? (value as any)?.config?.name;
			if (valueName === columnName) return key;
		}

		if (table) {
			for (const [key, value] of Object.entries(table)) {
				const valueName = (value as any)?.name ?? (value as any)?.config?.name;
				if (valueName === columnName) return key;
			}
		}

		return undefined;
	}

	private buildRelationWhereClause(
		relation: RelationConfig,
		relationWhere: Where | undefined,
		parentTable: PgTable,
		context?: CRUDContext,
	): any {
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
	) {
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
			.filter(Boolean) as any[];

		if (joinConditions.length === 0) return undefined;

		const whereConditions: any[] = [...joinConditions];

		if (relationWhere) {
			const nestedClause = this.buildWhereClauseInternal(
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
	) {
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
			.filter(Boolean) as any[];

		if (joinConditions.length === 0) return undefined;

		const whereConditions: any[] = [...joinConditions];

		if (relationWhere) {
			const nestedClause = this.buildWhereClauseInternal(
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
	) {
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

		const whereConditions: any[] = [eq(junctionSourceColumn, parentColumn)];

		if (relationWhere) {
			const nestedClause = this.buildWhereClauseInternal(
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
	 * Delegates to extracted buildWhereClause function
	 */
	private buildWhereClauseInternal(
		where: Where,
		useI18n: boolean = false,
		customTable?: any,
		context?: CRUDContext,
		customState?: any,
		i18nCurrentTable?: PgTable | null,
		i18nFallbackTable?: PgTable | null,
	) {
		return buildWhereClause(where, {
			table: customTable || this.table,
			state: customState || this.state,
			i18nCurrentTable: i18nCurrentTable ?? null,
			i18nFallbackTable: i18nFallbackTable ?? null,
			context,
			cms: this.cms,
			useI18n,
			db: this.db,
		});
	}
}
