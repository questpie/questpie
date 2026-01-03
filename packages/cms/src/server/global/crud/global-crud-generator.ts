import {
	eq,
	and,
	or,
	not,
	sql,
	inArray,
	count,
	sum,
	avg,
	min,
	max,
} from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { RelationConfig } from "#questpie/cms/server/collection/builder/types";
import { runWithCMSContext } from "#questpie/cms/server/config/context";
import { CMSError } from "#questpie/cms/server/errors";
import type {
	Columns,
	CRUDContext,
	Where,
	With,
} from "#questpie/cms/server/collection/crud/types";
import type {
	GlobalBuilderState,
	GlobalHookFunction,
	GlobalAccessContext,
	GlobalHookContext,
} from "#questpie/cms/server/global/builder/types";
import type {
	GlobalCRUD,
	GlobalFindVersionsOptions,
	GlobalGetOptions,
	GlobalRevertVersionOptions,
	GlobalUpdateOptions,
	GlobalVersionRecord,
} from "./types";

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
			accessMode: context.accessMode ?? "system",
			locale: context.locale ?? context.defaultLocale ?? "en",
			defaultLocale: context.defaultLocale ?? "en",
		};
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
				resourceType: "global",
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

	private async runWithCMSContext<TResult>(
		context: CRUDContext | undefined,
		fn: () => Promise<TResult>,
	): Promise<TResult> {
		if (!this.cms) {
			return fn();
		}

		const normalized = this.normalizeContext(context ?? {});
		return runWithCMSContext(this.cms, normalized, fn);
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
					("user" in lastArg ||
						"session" in lastArg ||
						"locale" in lastArg ||
						"accessMode" in lastArg ||
						"db" in lastArg ||
						"defaultLocale" in lastArg);

				if (isCRUDContext) {
					context = lastArg as CRUDContext;
				}
			}

			return this.runWithCMSContext(context, () => fn(...args));
		};
	}

	/**
	 * Wrapper for update() method: (data, context?, options?)
	 */
	private wrapUpdateWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return (...args: TArgs) => {
			let context: CRUDContext | undefined;

			if (args.length > 1) {
				const secondArg = args[1];
				const isCRUDContext =
					secondArg &&
					typeof secondArg === "object" &&
					("user" in secondArg ||
						"session" in secondArg ||
						"locale" in secondArg ||
						"accessMode" in secondArg ||
						"db" in secondArg ||
						"defaultLocale" in secondArg);

				if (isCRUDContext) {
					context = secondArg as CRUDContext;
				}
			}

			return this.runWithCMSContext(context, () => fn(...args));
		};
	}

	/**
	 * Generic wrapper for other methods where context is always last
	 */
	private wrapWithCMSContext<TArgs extends any[], TResult>(
		fn: (...args: TArgs) => Promise<TResult>,
	): (...args: TArgs) => Promise<TResult> {
		return (...args: TArgs) => {
			let context: CRUDContext | undefined;

			if (args.length > 0) {
				const lastArg = args[args.length - 1];
				const isCRUDContext =
					lastArg &&
					typeof lastArg === "object" &&
					("user" in lastArg ||
						"session" in lastArg ||
						"locale" in lastArg ||
						"accessMode" in lastArg ||
						"db" in lastArg ||
						"defaultLocale" in lastArg);

				if (isCRUDContext) {
					context = lastArg as CRUDContext;
				}
			}

			return this.runWithCMSContext(context, () => fn(...args));
		};
	}

	private buildSelectQuery(
		db: any,
		context: CRUDContext,
		columns?: Columns<TState["fields"]>,
	) {
		const selectObj = this.buildSelectObject(context, columns);
		let query = db.select(selectObj).from(this.table);

		if (this.i18nTable && context.locale) {
			query = query.leftJoin(
				this.i18nTable,
				and(
					eq((this.i18nTable as any).parentId, (this.table as any).id),
					eq((this.i18nTable as any).locale, context.locale),
				),
			);
		}

		return query;
	}

	private async getCurrentRow(db: any) {
		const rows = await db.select().from(this.table).limit(1);
		return rows[0] || null;
	}

	private createGet() {
		return async (
			options: GlobalGetOptions = {},
			context: CRUDContext = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);

			// Enforce access control
			const canRead = await this.enforceAccessControl(
				"read",
				normalized,
				null,
				options,
			);
			if (!canRead) {
				throw CMSError.forbidden({
					operation: "read",
					resource: this.state.name,
					reason: "User does not have permission to read global settings",
				});
			}

			// Hooks
			await this.executeHooks(this.state.hooks?.beforeRead, {
				db,
				locale: normalized.locale,
				user: normalized.user,
				context: normalized,
			});

			const rows = await this.buildSelectQuery(
				db,
				normalized,
				options.columns,
			).limit(1);
			let row = rows[0] || null;

			if (!row) {
				row = await db.transaction(async (tx: any) => {
					const [inserted] = await tx.insert(this.table).values({}).returning();
					if (!inserted) {
						throw CMSError.internal("Failed to auto-create global record");
					}

					await this.createVersion(tx, inserted, "create", normalized);

					const createdRows = await this.buildSelectQuery(
						tx,
						normalized,
						options.columns,
					)
						.where(eq((this.table as any).id, inserted.id))
						.limit(1);
					return createdRows[0] || inserted;
				});
			}

			if (row && options.with && this.cms) {
				await this.resolveRelations([row], options.with, normalized);
			}

			// Filter fields based on field-level read access
			if (row) {
				await this.filterFieldsForRead(row, normalized);
			}

			// Hooks
			if (row && this.state.hooks?.afterRead) {
				await this.executeHooks(this.state.hooks.afterRead, {
					db,
					row,
					locale: normalized.locale,
					user: normalized.user,
					context: normalized,
				});
			}

			return row;
		};
	}

	private createUpdate() {
		return async (
			data: any,
			context: CRUDContext = {},
			options: GlobalUpdateOptions = {},
		) => {
			const db = this.getDb(context);
			const normalized = this.normalizeContext(context);
			const existing = await this.getCurrentRow(db);

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				data,
			);
			if (!canUpdate)
				throw CMSError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to update global settings",
				});

			await this.executeHooks(this.state.hooks?.beforeUpdate, {
				db,
				row: existing,
				input: data,
				locale: normalized.locale,
				user: normalized.user,
				context: normalized,
			});

			await this.executeHooks(this.state.hooks?.beforeChange, {
				db,
				row: existing,
				input: data,
				locale: normalized.locale,
				user: normalized.user,
				context: normalized,
			});

			// Validate field-level write access
			await this.validateFieldWriteAccess(data, normalized, existing);

			let changeEvent: any = null;
			const updatedRecord = await db.transaction(async (tx: any) => {
				const { localized, nonLocalized } = this.splitLocalizedFields(data);

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
					const [inserted] = await tx
						.insert(this.table)
						.values(nonLocalized)
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

				const refreshedRows = updatedId
					? await this.buildSelectQuery(tx, normalized)
							.where(eq((this.table as any).id, updatedId))
							.limit(1)
					: [];
				const updatedRecord = refreshedRows[0] || baseRecord;

				if (!baseRecord) {
					throw CMSError.internal("Global record not found after update");
				}

				await this.createVersion(
					tx,
					baseRecord,
					existing ? "update" : "create",
					normalized,
				);

				await this.executeHooks(this.state.hooks?.afterUpdate, {
					db: tx,
					row: updatedRecord,
					input: data,
					locale: normalized.locale,
					user: normalized.user,
					context: normalized,
				});
				await this.executeHooks(this.state.hooks?.afterChange, {
					db: tx,
					row: updatedRecord,
					input: data,
					locale: normalized.locale,
					user: normalized.user,
					context: normalized,
				});

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
				throw CMSError.forbidden({
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
			if (!this.versionsTable) throw CMSError.notImplemented("Versioning");

			const hasVersionId = typeof options.versionId === "string";
			const hasVersion = typeof options.version === "number";

			if (!hasVersionId && !hasVersion) {
				throw CMSError.badRequest("Version or versionId required");
			}

			const parentId = options.id ?? (await this.getCurrentRow(db))?.id;
			if (!parentId) {
				throw CMSError.notFound("Global record", "");
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
				throw CMSError.notFound(
					"Version",
					options.versionId || String(options.version),
				);

			const existing = await this.getCurrentRow(db);
			if (!existing) throw CMSError.notFound("Global record", "");

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

			const canUpdate = await this.enforceAccessControl(
				"update",
				normalized,
				existing,
				restoreData,
			);
			if (!canUpdate)
				throw CMSError.forbidden({
					operation: "update",
					resource: this.state.name,
					reason: "User does not have permission to revert to this version",
				});

			await this.executeHooks(this.state.hooks?.beforeUpdate, {
				db,
				row: existing,
				input: restoreData,
				locale: normalized.locale,
				user: normalized.user,
				context: normalized,
			});

			await this.executeHooks(this.state.hooks?.beforeChange, {
				db,
				row: existing,
				input: restoreData,
				locale: normalized.locale,
				user: normalized.user,
				context: normalized,
			});

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
				}

				const baseRows = await tx
					.select()
					.from(this.table)
					.where(eq((this.table as any).id, parentId))
					.limit(1);
				const baseRecord = baseRows[0] || null;

				const refreshedRows = await this.buildSelectQuery(tx, normalized)
					.where(eq((this.table as any).id, parentId))
					.limit(1);
				const updatedRecord = refreshedRows[0] || baseRecord;

				if (!baseRecord) {
					throw CMSError.internal("Global record not found after revert");
				}

				await this.createVersion(tx, baseRecord, "update", normalized);

				await this.executeHooks(this.state.hooks?.afterUpdate, {
					db: tx,
					row: updatedRecord,
					input: restoreData,
					locale: normalized.locale,
					user: normalized.user,
					context: normalized,
				});
				await this.executeHooks(this.state.hooks?.afterChange, {
					db: tx,
					row: updatedRecord,
					input: restoreData,
					locale: normalized.locale,
					user: normalized.user,
					context: normalized,
				});

				return updatedRecord;
			});
		};
	}

	private async createVersion(
		tx: any,
		row: any,
		operation: "create" | "update" | "delete",
		context: CRUDContext,
	) {
		if (!this.versionsTable) return;

		const maxVersionQuery = await tx
			.select({
				max: sql<number>`MAX(${(this.versionsTable as any).versionNumber})`,
			})
			.from(this.versionsTable)
			.where(eq((this.versionsTable as any).id, row.id));

		const currentVersion = maxVersionQuery[0]?.max || 0;
		const newVersion = Number(currentVersion) + 1;

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

		const options = this.state.options.versioning;
		if (typeof options === "object" && options.maxVersions) {
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

	private buildSelectObject(
		context: CRUDContext,
		columns?: Columns<TState["fields"]>,
	) {
		const select: any = {
			id: (this.table as any).id,
		};
		const defaultLocale = context?.defaultLocale || "en";

		// If columns is specified, use partial selection
		const includeAllFields = !columns;

		for (const [name, _column] of Object.entries(this.state.fields)) {
			// Skip if columns filter is active and this field is not selected
			if (columns && !columns[name]) continue;

			if (
				this.state.localized.includes(name as any) &&
				this.i18nTable &&
				context.locale
			) {
				const i18nTable = this.i18nTable as any;
				select[name] = sql`COALESCE(
					${i18nTable[name]},
					(SELECT ${i18nTable[name]} FROM ${this.i18nTable}
					 WHERE ${i18nTable.parentId} = ${(this.table as any).id}
					 AND ${i18nTable.locale} = ${defaultLocale} LIMIT 1)
				)`;
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
		const defaultLocale = context?.defaultLocale || "en";

		for (const [name, _column] of Object.entries(this.state.fields)) {
			if (
				this.state.localized.includes(name as any) &&
				this.i18nVersionsTable &&
				context.locale
			) {
				const i18nVersionsTable = this.i18nVersionsTable as any;
				select[name] = sql`COALESCE(
					${i18nVersionsTable[name]},
					(SELECT ${i18nVersionsTable[name]} FROM ${this.i18nVersionsTable}
					 WHERE ${i18nVersionsTable.parentId} = ${versionsTable.id}
					 AND ${i18nVersionsTable.versionNumber} = ${versionsTable.versionNumber}
					 AND ${i18nVersionsTable.locale} = ${defaultLocale} LIMIT 1)
				)`;
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

	private async enforceAccessControl(
		operation: "read" | "update",
		context: CRUDContext,
		row: any,
		input?: any,
	): Promise<boolean> {
		const normalized = this.normalizeContext(context);
		const db = this.getDb(normalized);

		if (normalized.accessMode === "system") return true;

		const accessRule = this.state.access?.[operation];
		if (accessRule === undefined) return true;
		if (typeof accessRule === "boolean") return accessRule;
		if (typeof accessRule === "string")
			return normalized.user?.role === accessRule;
		if (typeof accessRule === "function") {
			return await accessRule({
				user: normalized.user,
				row,
				input,
				db,
				context: normalized,
			} as GlobalAccessContext);
		}
		return true;
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

		const fieldAccess = this.state.access?.fields;
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

			// String role rule
			if (typeof readRule === "string") {
				const userRole =
					(normalized as any).role || (normalized.user as any)?.role;
				if (userRole === readRule) {
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
	 */
	private async filterFieldsForRead(
		result: any,
		context: CRUDContext,
	): Promise<void> {
		if (!result) return;

		const normalized = this.normalizeContext(context);

		// System mode bypasses field access control
		if (normalized.accessMode === "system") return;

		const fieldAccess = this.state.access?.fields;
		if (!fieldAccess) return; // No field-level access rules

		const db = this.getDb(context);

		// Check each field in the result
		const fieldsToRemove: string[] = [];

		for (const fieldName of Object.keys(result)) {
			// Skip meta fields
			if (
				fieldName === "id" ||
				fieldName === "createdAt" ||
				fieldName === "updatedAt"
			) {
				continue;
			}

			const access = fieldAccess[fieldName];
			if (!access || access.read === undefined) {
				// No access rule for this field - allow read
				continue;
			}

			const readRule = access.read;

			// Boolean rule
			if (typeof readRule === "boolean") {
				if (!readRule) {
					fieldsToRemove.push(fieldName);
				}
				continue;
			}

			// String role rule
			if (typeof readRule === "string") {
				const userRole =
					(normalized as any).role || (normalized.user as any)?.role;
				if (userRole !== readRule) {
					fieldsToRemove.push(fieldName);
				}
				continue;
			}

			// Function rule
			if (typeof readRule === "function") {
				const canRead = await readRule({
					user: normalized.user,
					row: result,
					input: undefined,
					db,
					context: normalized,
				} as GlobalAccessContext);

				// Field-level access should return boolean (not AccessWhere)
				if (canRead !== true) {
					fieldsToRemove.push(fieldName);
				}
			}
		}

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
		row?: any,
	): Promise<boolean> {
		const normalized = this.normalizeContext(context);

		// System mode can write all fields
		if (normalized.accessMode === "system") return true;

		const fieldAccess = this.state.access?.fields;
		if (!fieldAccess) return true; // No field-level access rules

		const access = fieldAccess[fieldName];
		if (!access || access.write === undefined) {
			// No access rule for this field - allow write
			return true;
		}

		const writeRule = access.write;
		const db = this.getDb(context);

		// Boolean rule
		if (typeof writeRule === "boolean") {
			return writeRule;
		}

		// String role rule
		if (typeof writeRule === "string") {
			const userRole =
				(normalized as any).role || (normalized.user as any)?.role;
			return userRole === writeRule;
		}

		// Function rule
		if (typeof writeRule === "function") {
			const result = await writeRule({
				user: normalized.user,
				row,
				input: undefined,
				db,
				context: normalized,
			} as GlobalAccessContext);

			// Field-level access: only boolean true allows write
			// AccessWhere is treated as deny (it's for record-level filtering)
			return result === true;
		}

		return true;
	}

	/**
	 * Validate write access for all fields in input data
	 */
	private async validateFieldWriteAccess(
		data: any,
		context: CRUDContext,
		existing?: any,
	): Promise<void> {
		const normalized = this.normalizeContext(context);

		// System mode bypasses field access control
		if (normalized.accessMode === "system") return;

		const fieldAccess = this.state.access?.fields;
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

			const canWrite = await this.canWriteField(fieldName, context, existing);
			if (!canWrite) {
				throw CMSError.forbidden({
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

	private buildWhereClause(
		where: Where,
		useI18n: boolean = false,
		customTable?: any,
		context?: CRUDContext,
		customState?: any,
		customI18nTable?: PgTable | null,
	) {
		const conditions: any[] = [];
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
					.filter(Boolean) as any[];
				if (subClauses.length > 0) {
					conditions.push(and(...subClauses));
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
					.filter(Boolean) as any[];
				if (subClauses.length > 0) {
					conditions.push(or(...subClauses));
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

	private buildOperatorCondition(column: any, op: string, value: any) {
		switch (op) {
			case "eq":
				return eq(column, value);
			case "ne":
				return sql`${column} != ${value}`;
			case "not":
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
}
