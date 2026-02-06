import type {
  ApplyQuery,
  Columns,
  CRUDContext,
  NestedRelationMutation,
  With,
} from "#questpie/server/collection/crud/types.js";
import type {
  ExtractRelationInsert,
  Prettify,
} from "#questpie/shared/type-utils.js";

/**
 * Helper type to detect if a type is `any`
 * Returns true only if T is the `any` type
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Helper type to get value type from array or single relation
 */
type RelationValue<T> = T extends (infer U)[] ? U : T;

/**
 * Helper type for extracting relation mutation fields for globals
 * Uses the same pattern as collection RelationMutations
 */
type GlobalRelationMutations<TRelations> = [TRelations] extends [never]
  ? {}
  : IsAny<TRelations> extends true
    ? {} // When TRelations is `any`, don't create index signature
    : string extends keyof TRelations
      ? {} // TRelations has index signature (e.g., Record<string, ...>), don't add relation fields
      : [TRelations] extends [Record<string, any>]
        ? keyof TRelations extends never
          ? {} // No relations, return empty object
          : {
              [K in keyof TRelations]?: NestedRelationMutation<
                ExtractRelationInsert<RelationValue<TRelations[K]>>
              >;
            }
        : {}; // Not a record type or unknown, return empty object

/**
 * Global update input with optional nested relation mutations
 */
export type GlobalUpdateInput<TUpdate = any, TRelations = any> = Prettify<
  Partial<TUpdate> & GlobalRelationMutations<TRelations>
>;

/**
 * Options for getting a global record
 * Type-safe with support for partial selection and relation loading
 */
export interface GlobalGetOptions<TFields = any, TRelations = any> {
  /**
   * Load relations
   */
  with?: With<TRelations>;

  /**
   * Select specific columns only (partial selection)
   */
  columns?: Columns<TFields>;

  /**
   * Override locale for this request.
   */
  locale?: string;

  /**
   * Disable fallback to default locale when translation is missing.
   */
  localeFallback?: boolean;
}

/**
 * Options for updating a global record
 * Type-safe with support for relation loading in response
 */
export interface GlobalUpdateOptions<TRelations = any> {
  /**
   * Load relations in the response
   */
  with?: With<TRelations>;

  /**
   * Override locale for this request.
   */
  locale?: string;

  /**
   * Disable fallback to default locale when translation is missing.
   */
  localeFallback?: boolean;
}

export interface GlobalFindVersionsOptions {
  id?: string;
  limit?: number;
  offset?: number;
}

export interface GlobalRevertVersionOptions {
  id?: string;
  version?: number;
  versionId?: string;
}

export interface GlobalVersionRecord {
  id: string;
  versionId: string;
  versionNumber: number;
  versionOperation: string;
  versionUserId: string | null;
  versionCreatedAt: Date;
  [key: string]: any;
}

/**
 * Type-safe Global CRUD interface
 * Similar to Collection CRUD but adapted for singleton pattern
 */
export interface GlobalCRUD<
  TSelect = any,
  _TInsert = any,
  TUpdate = any,
  TRelations = any,
> {
  /**
   * Get the global record (singleton)
   * Supports partial selection and relation loading
   */
  get<TQuery extends GlobalGetOptions<TSelect, TRelations>>(
    options?: TQuery,
    context?: CRUDContext,
  ): Promise<ApplyQuery<TSelect, TRelations, TQuery> | null>;

  /**
   * Update the global record
   * Supports loading relations in response and nested relation mutations
   */
  update<TQuery extends GlobalUpdateOptions<TRelations>>(
    data: GlobalUpdateInput<TUpdate, TRelations>,
    context?: CRUDContext,
    options?: TQuery,
  ): Promise<ApplyQuery<TSelect, TRelations, TQuery>>;

  findVersions(
    options?: GlobalFindVersionsOptions,
    context?: CRUDContext,
  ): Promise<GlobalVersionRecord[]>;

  revertToVersion(
    options: GlobalRevertVersionOptions,
    context?: CRUDContext,
  ): Promise<TSelect>;
}
