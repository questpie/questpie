import {
  and,
  type Column,
  count,
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
} from "#questpie/server/collection/builder/types.js";

/** Title expression for SQL queries - resolved column or SQL expression */
type TitleExpressionSQL = SQL | Column | null;

import {
  indexToSearch,
  removeFromSearch,
} from "#questpie/server/collection/crud/integrations/index.js";
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
  mergeWhereWithAccess,
  validateFieldsWriteAccess,
} from "#questpie/server/collection/crud/shared/access-control.js";
import {
  extractLocalizedFieldNames,
  extractNestedLocalizationSchemas,
  type NestedLocalizationSchema,
} from "#questpie/server/collection/crud/shared/field-extraction.js";
import {
  appendRealtimeChange,
  createHookContext,
  executeHooks,
  getDb,
  mergeI18nRows,
  normalizeContext,
  notifyRealtimeChange,
  onAfterCommit,
  resolveFieldKey,
  splitLocalizedFields,
  splitLocalizedFieldsWithSchema,
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
  FindVersionsOptions,
  OrderBy,
  PaginatedResult,
  RestoreParams,
  RevertVersionOptions,
  UpdateParams,
  UploadFile,
  Where,
  With,
} from "#questpie/server/collection/crud/types.js";
import { createVersionRecord } from "#questpie/server/collection/crud/versioning/index.js";
import type { Questpie } from "#questpie/server/config/cms.js";
import { runWithContext } from "#questpie/server/config/context.js";
import type { StorageVisibility } from "#questpie/server/config/types.js";
import { ApiError, parseDatabaseError } from "#questpie/server/errors/index.js";
import {
  applyFieldInputHooks,
  applyFieldOutputHooks,
  extractFieldDefinitionAccessRules,
} from "#questpie/server/fields/runtime.js";
import type { FieldDefinitionAccess } from "#questpie/server/fields/types.js";

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
    _getVirtuals?: (context: any) => TState["virtuals"],
    private getVirtualsWithAliases?: (
      context: any,
      i18nCurrentTable: PgTable | null,
      i18nFallbackTable: PgTable | null,
    ) => TState["virtuals"],
    private getTitleExpression?: (context: any) => TitleExpressionSQL,
    private getVirtualsForVersions?: (context: any) => TState["virtuals"],
    private getVirtualsForVersionsWithAliases?: (
      context: any,
      i18nVersionsCurrentTable: PgTable | null,
      i18nVersionsFallbackTable: PgTable | null,
    ) => TState["virtuals"],
    private getTitleExpressionForVersions?: (
      context: any,
    ) => TitleExpressionSQL,
    _getRawTitleExpression?: (context: any) => TitleExpressionSQL,
    private cms?: Questpie<any>,
  ) {}

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

  /**
   * Generate CRUD operations
   */
  generate(): CRUD {
    const find = this.wrapWithCMSContext(this.createFind());
    const findOne = this.wrapWithCMSContext(this.createFindOne());
    const updateMany = this.wrapWithCMSContext(this.createUpdateMany());
    const deleteMany = this.wrapWithCMSContext(this.createDeleteMany());
    const restoreById = this.wrapWithCMSContext(this.createRestore());

    const crud: CRUD = {
      find,
      findOne,
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

    // Add upload methods if collection has upload config
    if (this.state.upload) {
      crud.upload = this.wrapWithCMSContext(this.createUpload());
      crud.uploadMany = this.wrapWithCMSContext(this.createUploadMany());
    }

    crud["~internalState"] = this.state;
    crud["~internalRelatedTable"] = this.table;
    crud["~internalI18nTable"] = this.i18nTable;
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

  private wrapWithCMSContext<TArgs extends any[], TResult>(
    fn: (...args: TArgs) => Promise<TResult>,
  ): (...args: TArgs) => Promise<TResult> {
    // Direct passthrough - context is passed explicitly through function arguments
    return fn;
  }

  private getFieldAccessRules():
    | Record<string, FieldDefinitionAccess>
    | undefined {
    return extractFieldDefinitionAccessRules(this.state.fieldDefinitions);
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
  ): Promise<PaginatedResult<T> | T | null> {
    // Normalize context FIRST to ensure locale defaults are applied
    const normalized = this.normalizeContext(context);
    const db = this.getDb(normalized);

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

    // Execute beforeRead hooks (read doesn't modify data)
    if (this.state.hooks?.beforeRead) {
      await this.executeHooks(
        this.state.hooks.beforeRead as any,
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

    // Get total count only for 'many' mode (pagination)
    let totalDocs = 0;
    if (mode === "many") {
      const countFn = this.createCount();
      totalDocs = await countFn(
        { where: mergedWhere, includeDeleted },
        { ...normalized, accessMode: "system" },
      );
    }

    // Determine if we are using i18n (i18n table exists = collection has localized fields)
    // If i18n table exists, we MUST use i18n queries to properly fetch localized fields
    const useI18n = !!this.i18nTable;
    const needsFallback =
      useI18n &&
      normalized.localeFallback !== false &&
      normalized.locale !== normalized.defaultLocale;

    // Create aliased i18n tables for current and fallback locales
    const i18nCurrentTable = useI18n
      ? alias(this.i18nTable!, "i18n_current")
      : null;
    const i18nFallbackTable = needsFallback
      ? alias(this.i18nTable!, "i18n_fallback")
      : null;

    // Build SELECT object with aliased i18n tables
    const selectObj = this.buildSelectObject(
      options.columns || (options as any).select,
      options.extras,
      normalized,
      i18nCurrentTable,
      i18nFallbackTable,
    );

    // Start building query
    let query = db.select(selectObj).from(this.table);

    // Add i18n joins if locale provided and localized fields exist
    if (useI18n && i18nCurrentTable) {
      // LEFT JOIN for current locale
      query = query.leftJoin(
        i18nCurrentTable,
        and(
          eq((i18nCurrentTable as any).parentId, (this.table as any).id),
          eq((i18nCurrentTable as any).locale, normalized.locale!),
        ),
      );

      // LEFT JOIN for fallback locale (only if different from current)
      if (needsFallback && i18nFallbackTable) {
        query = query.leftJoin(
          i18nFallbackTable,
          and(
            eq((i18nFallbackTable as any).parentId, (this.table as any).id),
            eq((i18nFallbackTable as any).locale, normalized.defaultLocale!),
          ),
        );
      }
    }

    // WHERE clause with soft delete filter
    const whereClauses: SQL[] = [];

    if (mergedWhere) {
      const whereClause = this.buildWhereClause(
        mergedWhere,
        useI18n,
        undefined,
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
      const softDeleteFilter = sql`${(this.table as any).deletedAt} IS NULL`;
      whereClauses.push(softDeleteFilter);
    }

    // Search filter by _title (for relation pickers, etc.) - only for 'many' mode
    if (mode === "many" && (options as any).search) {
      const searchTerm = (options as any).search;
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
            table: this.table,
            state: this.state,
            i18nCurrentTable,
            i18nFallbackTable,
            useI18n,
          });
        }
        // If title is a regular field
        else if (this.state.title in this.state.fields) {
          titleExpr = (this.table as any)[this.state.title];
        }
        // If title is a virtual field, get from virtuals with aliased tables
        else if (this.getVirtualsWithAliases) {
          const virtuals = this.getVirtualsWithAliases(
            normalized,
            i18nCurrentTable,
            i18nFallbackTable,
          );
          if (virtuals && this.state.title in virtuals) {
            titleExpr = (virtuals as any)[this.state.title];
          }
        }
      }

      titleExpr = titleExpr || (this.table as any).id;
      // Case-insensitive search using ILIKE
      const searchFilter = sql`${titleExpr}::text ILIKE ${`%${searchTerm}%`}`;
      whereClauses.push(searchFilter);
    }

    if (whereClauses.length > 0) {
      query = query.where(and(...whereClauses));
    }

    // ORDER BY
    if (options.orderBy) {
      const orderClauses = this.buildOrderByClauses(
        options.orderBy,
        useI18n,
        i18nCurrentTable,
        i18nFallbackTable,
      );
      for (const clause of orderClauses) {
        query = query.orderBy(clause);
      }
    }

    // LIMIT - for 'one' mode always 1, for 'many' use options
    if (mode === "one") {
      query = query.limit(1);
    } else {
      const manyOptions = options as FindManyOptions;
      if (manyOptions.limit !== undefined) {
        query = query.limit(manyOptions.limit);
      }
      if (manyOptions.offset !== undefined) {
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
    if (rows.length > 0 && options.with && this.cms) {
      await this.resolveRelations(rows, options.with, normalized);
    }

    // Filter fields based on field-level read access
    for (const row of rows) {
      await this.filterFieldsForRead(row, normalized);
      await this.runFieldOutputHooks(row, "read", normalized, db);
    }

    // Execute afterRead hooks
    if (this.state.hooks?.afterRead) {
      for (const row of rows) {
        await this.executeHooks(
          this.state.hooks.afterRead,
          this.createHookContext({
            data: row,
            operation: "read",
            context: normalized,
            db,
          }),
        );
      }
    }

    // Return based on mode
    if (mode === "one") {
      return (rows[0] as T) || null;
    }

    // Construct paginated result for 'many' mode
    const manyOptions = options as FindManyOptions;
    const limit = manyOptions.limit ?? totalDocs;
    const totalPages = limit > 0 ? Math.ceil(totalDocs / limit) : 1;
    const offset = manyOptions.offset ?? 0;
    const page = limit > 0 ? Math.floor(offset / limit) + 1 : 1;
    const pagingCounter = (page - 1) * limit + 1;
    const hasPrevPage = page > 1;
    const hasNextPage = page < totalPages;
    const prevPage = hasPrevPage ? page - 1 : null;
    const nextPage = hasNextPage ? page + 1 : null;

    return {
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
  }

  /**
   * Create find operation - returns paginated results
   */
  private createFind() {
    return async (
      options: FindManyOptions = {},
      context: CRUDContext = {},
    ): Promise<PaginatedResult<any>> => {
      return this._executeFind(options, context, "many") as Promise<
        PaginatedResult<any>
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
    if (!rows.length || !withConfig || !this.cms) return;
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

      const relatedCrud = this.cms.api.collections[
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
          ? (relationOptions as Record<string, any>)
          : { with: relationOptions };
      }

      const hasFieldConfig =
        (relation.fields && relation.fields.length > 0) ||
        typeof (relation as any).field === "string";

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
            cms: this.cms,
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
            cms: this.cms,
          });
        }
      }
      // ManyToMany relation (through junction table)
      else if (relation.type === "manyToMany" && relation.through) {
        const junctionCrud = this.cms.api.collections[
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
   * Handle cascade delete operations for relations
   * Delegates to extracted handleCascadeDelete utility
   */
  private async handleCascadeDeleteInternal(
    _id: string,
    record: any,
    context: CRUDContext,
  ): Promise<void> {
    if (!this.cms || !this.state.relations) return;
    await handleCascadeDelete({
      record,
      relations: this.state.relations,
      cms: this.cms,
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
    if (!this.cms || !this.state.relations) {
      return { regularFields, nestedRelations };
    }
    return applyBelongsToRelations(
      regularFields,
      nestedRelations,
      this.state.relations,
      this.cms,
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
    if (!this.cms || !this.state.relations) return;
    await processNestedRelations({
      parentRecord,
      nestedRelations,
      relations: this.state.relations,
      cms: this.cms,
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
      return runWithContext(
        {
          app: this.cms,
          session: normalized.session,
          db,
          locale: normalized.locale,
          accessMode: normalized.accessMode,
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
            this.state.hooks?.beforeValidate as any,
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
          await this.executeHooks(
            this.state.hooks?.beforeChange as any,
            this.createHookContext({
              data: regularFields,
              operation: "create",
              context,
              db,
            }),
          );

          let changeEvent: any = null;
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
                      (i18nCurrentTable as any).parentId,
                      (this.table as any).id,
                    ),
                    eq((i18nCurrentTable as any).locale, context.locale!),
                  ),
                );

                if (needsFallback && i18nFallbackTable) {
                  query = query.leftJoin(
                    i18nFallbackTable,
                    and(
                      eq(
                        (i18nFallbackTable as any).parentId,
                        (this.table as any).id,
                      ),
                      eq(
                        (i18nFallbackTable as any).locale,
                        context.defaultLocale!,
                      ),
                    ),
                  );
                }
              }

              let [createdRecord] = await query.where(
                eq((this.table as any).id, insertedRecord.id),
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
              await this.executeHooks(
                this.state.hooks?.afterChange as any,
                this.createHookContext({
                  data: createdRecord,
                  operation: "create",
                  context,
                  db: tx,
                }),
              );

              changeEvent = await this.appendRealtimeChange(
                {
                  operation: "create",
                  recordId: createdRecord.id,
                  payload: createdRecord as Record<string, unknown>,
                },
                context,
                tx,
              );

              // Queue search indexing to run after transaction commits
              onAfterCommit(async () => {
                await this.indexToSearch(createdRecord, context);
              });

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
              context,
              db,
            }),
          );

          await this.notifyRealtimeChange(changeEvent);
          return record;
        },
      );
    };
  }

  /**
   * Shared core update handler for updateById and updateMany
   * Ensures consistency in access control, hooks, validation, and re-fetching.
   */
  private async _executeUpdate(
    params: UpdateParams | { where: Where; data: Record<string, any> },
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
      ? { where: (params as any).where }
      : { where: { id: (params as any).id } };

    const recordsResult = (await this._executeFind(
      { ...findOptions, includeDeleted: true },
      { ...normalized, accessMode: "system" },
      "many",
    )) as PaginatedResult<any>;

    const records = recordsResult.docs;

    if (records.length === 0) {
      if (isBatch) return [];
      throw ApiError.notFound("Record", (params as any).id);
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
        this.state.hooks?.beforeValidate as any,
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

      await this.executeHooks(
        this.state.hooks?.beforeChange as any,
        this.createHookContext({
          data: regularFields,
          original: existing,
          operation: "update",
          context: normalized,
          db,
        }),
      );
    }

    let changeEvent: any = null;
    let updatedRecords: any[];

    try {
      updatedRecords = await withTransaction(db, async (tx: any) => {
        const txContext = { ...normalized, db: tx };

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
        const recordIds = records.map((r: any) => r.id);

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
            .where(inArray((this.table as any).id, recordIds));
        }

        // Upsert localized fields
        const hasLocalizedData =
          Object.keys(localized).length > 0 || nestedLocalized != null;
        if (this.i18nTable && normalized.locale && hasLocalizedData) {
          const i18nValues = {
            ...localized,
            ...(nestedLocalized != null ? { _localized: nestedLocalized } : {}),
          };

          for (const recordId of recordIds) {
            await tx
              .insert(this.i18nTable)
              .values({
                parentId: recordId,
                locale: normalized.locale,
                ...i18nValues,
              })
              .onConflictDoUpdate({
                target: [
                  (this.i18nTable as any).parentId,
                  (this.i18nTable as any).locale,
                ],
                set: i18nValues,
              });
          }
        }

        // Process nested relation operations
        for (const existing of records) {
          await this.processNestedRelationsInternal(
            existing,
            nestedRelations,
            txContext,
            tx,
          );
        }

        // Re-fetch updated records with full state (i18n, virtuals, title, etc.)
        const reFetchResult = (await this._executeFind(
          { where: { id: { in: recordIds } }, includeDeleted: true },
          { ...txContext, accessMode: "system" },
          "many",
        )) as PaginatedResult<any>;

        const refetchedRecords = reFetchResult.docs;

        // Create versions and run afterChange hooks
        for (const updated of refetchedRecords) {
          const original = records.find((r) => r.id === updated.id);

          await this.createVersion(tx, updated, "update", txContext);

          await this.executeHooks(
            this.state.hooks?.afterChange as any,
            this.createHookContext({
              data: updated,
              original,
              operation: "update",
              context: txContext,
              db: tx,
            }),
          );
        }

        // Realtime change
        changeEvent = await this.appendRealtimeChange(
          {
            operation: isBatch ? "bulk_update" : "update",
            recordId: isBatch ? undefined : refetchedRecords[0].id,
            payload: isBatch
              ? { count: refetchedRecords.length }
              : (refetchedRecords[0] as Record<string, unknown>),
          },
          txContext,
          tx,
        );

        // Queue search indexing to run after transaction commits
        for (const updated of refetchedRecords) {
          onAfterCommit(async () => {
            await this.indexToSearch(updated, normalized);
          });
        }

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
    }

    await this.notifyRealtimeChange(changeEvent);

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
      const db = this.getDb(context);
      const { id } = params;

      // Execute beforeOperation hook
      await this.executeHooks(
        this.state.hooks?.beforeOperation,
        this.createHookContext({
          data: params as any,
          operation: "delete",
          context,
          db,
        }),
      );

      // Load existing record
      // Use select instead of query to avoid dependency on query builder structure which might not exist if collection not registered in db.query
      const existingRows = await db
        .select()
        .from(this.table)
        .where(eq((this.table as any).id, id))
        .limit(1);
      const existing = existingRows[0];

      if (!existing) {
        throw ApiError.notFound("Record", id);
      }

      // Enforce access control
      const canDelete = await this.enforceAccessControl(
        "delete",
        context,
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
      await this.executeHooks(
        this.state.hooks?.beforeDelete as any,
        this.createHookContext({
          data: existing,
          original: existing,
          operation: "delete",
          context,
          db,
        }),
      );

      // Handle cascade operations BEFORE delete
      await this.handleCascadeDeleteInternal(id, existing, context);

      let changeEvent: any = null;
      // Use transaction for delete + version
      await withTransaction(db, async (tx: any) => {
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

        // Queue search index removal to run after transaction commits
        onAfterCommit(async () => {
          await this.removeFromSearch(id, context);
        });
      });

      // Execute afterDelete hooks
      await this.executeHooks(
        this.state.hooks?.afterDelete as any,
        this.createHookContext({
          data: existing,
          original: existing,
          operation: "delete",
          context,
          db,
        }),
      );

      await this.notifyRealtimeChange(changeEvent);

      const result = { success: true, data: existing };

      // Execute afterRead hook (transform output)
      await this.executeHooks(
        this.state.hooks?.afterRead,
        this.createHookContext({
          data: existing,
          original: existing,
          operation: "delete",
          context,
          db,
        }),
      );

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

      const db = this.getDb(context);
      const { id } = params;

      const existingRows = await db
        .select()
        .from(this.table)
        .where(eq((this.table as any).id, id))
        .limit(1);
      const existing = existingRows[0];

      if (!existing) {
        throw ApiError.notFound("Record", id);
      }

      const canUpdate = await this.enforceAccessControl(
        "update",
        context,
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
   * Create deleteMany operation - smart batched deletes
   * 1. find to get all matching records (for hooks + access control)
   * 2. Loop through beforeDelete hooks
   * 3. Single batched DELETE WHERE query
   * 4. Loop through afterDelete hooks
   */
  private createDeleteMany() {
    return async (params: { where: Where }, context: CRUDContext = {}) => {
      const db = this.getDb(context);
      const find = this.createFind();

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
        await this.executeHooks(
          this.state.hooks?.beforeDelete as any,
          this.createHookContext({
            data: record,
            original: record,
            operation: "delete",
            context,
            db,
          }),
        );

        // Handle cascade operations per record
        await this.handleCascadeDeleteInternal(record.id, record, context);
      }

      let changeEvent: any = null;
      // 3. Batched DELETE query
      await withTransaction(db, async (tx: any) => {
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

        // Queue search index removal to run after transaction commits
        for (const record of records) {
          onAfterCommit(async () => {
            await this.removeFromSearch(record.id, context);
          });
        }
      });

      // 4. Loop through afterDelete hooks
      for (const record of records) {
        // Execute afterDelete hooks
        await this.executeHooks(
          this.state.hooks?.afterDelete as any,
          this.createHookContext({
            data: record,
            original: record,
            operation: "delete",
            context,
            db,
          }),
        );
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
                (i18nVersionsCurrentTable as any).parentId,
                (this.versionsTable as any).id,
              ),
              eq(
                (i18nVersionsCurrentTable as any).versionNumber,
                (this.versionsTable as any).versionNumber,
              ),
              eq((i18nVersionsCurrentTable as any).locale, normalized.locale!),
            ),
          );

        // Add fallback join if needed
        if (needsFallback && i18nVersionsFallbackTable) {
          query = query.leftJoin(
            i18nVersionsFallbackTable,
            and(
              eq(
                (i18nVersionsFallbackTable as any).parentId,
                (this.versionsTable as any).id,
              ),
              eq(
                (i18nVersionsFallbackTable as any).versionNumber,
                (this.versionsTable as any).versionNumber,
              ),
              eq(
                (i18nVersionsFallbackTable as any).locale,
                normalized.defaultLocale!,
              ),
            ),
          );
        }

        query = query
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
        throw ApiError.badRequest("Version or versionId required");
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

      if (!version)
        throw ApiError.notFound(
          "Version",
          options.versionId || String(options.version),
        );

      const existingRows = await db
        .select()
        .from(this.table)
        .where(eq((this.table as any).id, options.id))
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

      await this.executeHooks(
        this.state.hooks?.beforeChange as any,
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
        const result = updatedRows[0];

        await this.createVersion(tx, result, "update", normalized);

        await this.executeHooks(
          this.state.hooks?.afterChange as any,
          this.createHookContext({
            data: result,
            original: existing,
            operation: "update",
            context: normalized,
            db: tx,
          }),
        );

        // Queue search indexing to run after transaction commits
        if (result) {
          onAfterCommit(async () => {
            await this.indexToSearch(result, normalized);
          });
        }

        return result;
      });

      return updated;
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
   * Create hook context with full CMS access
   * Delegates to shared createHookContext utility
   */
  private createHookContext(params: {
    data: any;
    original?: any;
    operation: "create" | "update" | "delete" | "read";
    context: CRUDContext;
    db: any;
  }): HookContext<any, any, any> {
    return createHookContext({
      ...params,
      cms: this.cms,
    });
  }

  /**
   * Enforce access control
   * Delegates to extracted executeAccessRule utility
   * Falls back to CMS defaultAccess if collection doesn't define its own rules
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

    // Use collection's access rule, or fall back to CMS defaultAccess
    const accessRule =
      this.state.access?.[operation] ?? this.cms?.defaultAccess?.[operation];
    return executeAccessRule(accessRule, {
      cms: this.cms,
      db,
      session: normalized.session,
      locale: normalized.locale,
      row,
      input,
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
      { cms: this.cms, db },
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
      cms: this.cms,
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
  ): any {
    return buildSelectObject(columns, extras, context, {
      table: this.table,
      state: this.state,
      i18nCurrentTable: i18nCurrentTable ?? null,
      i18nFallbackTable: i18nFallbackTable ?? null,
      getVirtualsWithAliases: this.getVirtualsWithAliases,
      getTitle: this.getTitleExpression,
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
  ): SQL[] {
    return buildOrderByClauses(orderBy, {
      table: this.table,
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
   * are localized (no $i18n wrappers needed from client).
   * Falls back to $i18n wrapper detection for backward compatibility.
   *
   * @param input - Input data
   */
  private splitLocalizedFields(input: any) {
    const localizedFieldNames = this.getLocalizedFieldNames();
    const nestedSchemas = this.getNestedLocalizationSchemas();

    // Use schema-based approach if we have field definitions with nested schemas
    if (Object.keys(nestedSchemas).length > 0) {
      return splitLocalizedFieldsWithSchema(
        input,
        localizedFieldNames,
        nestedSchemas,
      );
    }

    // Fallback to legacy $i18n wrapper detection
    return splitLocalizedFields(input, localizedFieldNames);
  }

  /**
   * Index record to search service
   * Delegates to extracted indexToSearch function
   */
  private async indexToSearch(
    record: any,
    context: CRUDContext,
  ): Promise<void> {
    if (!this.cms) return;
    return indexToSearch(record, context, {
      cms: this.cms,
      state: this.state,
      getTitle: this.getTitleExpression,
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
    return appendRealtimeChange(params, context, db, this.cms, this.state.name);
  }

  /**
   * Notify realtime subscribers of a change
   * Delegates to shared notifyRealtimeChange utility
   */
  private async notifyRealtimeChange(change: unknown) {
    return notifyRealtimeChange(change, this.cms);
  }

  /**
   * Remove record from search index
   * Delegates to extracted removeFromSearch function
   */
  private async removeFromSearch(
    recordId: string,
    context: CRUDContext,
  ): Promise<void> {
    if (!this.cms) return;
    return removeFromSearch(recordId, context, {
      cms: this.cms,
      state: this.state,
    });
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

      if (!this.cms?.storage) {
        throw ApiError.internal("Storage not configured");
      }

      const uploadOptions = this.state.upload;

      // Validate file size
      if (uploadOptions.maxSize && file.size > uploadOptions.maxSize) {
        throw ApiError.badRequest(
          `File size ${file.size} exceeds maximum allowed size ${uploadOptions.maxSize}`,
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
          );
        }
      }

      // Generate unique storage key
      const key = `${crypto.randomUUID()}-${file.name}`;
      const visibility: StorageVisibility =
        uploadOptions.visibility || "public";

      // Upload file to storage using streaming when available
      // Normalize MIME type (remove charset etc)
      const mimeType = file.type.split(";")[0]?.trim() || file.type;

      // Streaming is more memory-efficient for large files
      if (file.stream) {
        // Convert web ReadableStream to Node.js Readable for Flydrive
        const { Readable } = await import("node:stream");
        const webStream = file.stream();
        const nodeStream = Readable.fromWeb(webStream as any);
        await this.cms.storage.use().putStream(key, nodeStream, {
          contentType: file.type,
          contentLength: file.size,
          visibility,
        });
      } else {
        // Fallback to buffer-based upload for files without stream support
        const buffer = await file.arrayBuffer();
        await this.cms.storage.use().put(key, new Uint8Array(buffer), {
          contentType: file.type,
          contentLength: file.size,
          visibility,
        });
      }

      // Create record using the existing create method
      const createFn = this.createCreate();
      const record = await createFn(
        {
          key,
          filename: file.name,
          mimeType,
          size: file.size,
          visibility,
          ...additionalData,
        } as any,
        context,
      );

      return record;
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
