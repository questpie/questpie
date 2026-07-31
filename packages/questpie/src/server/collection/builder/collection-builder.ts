import type { Prettify } from "better-auth";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { ZodType } from "zod";

import type {
	CollectionInsert,
	CollectionSelect,
	CollectionUpdate,
} from "#questpie/server/collection/builder/collection.js";
import { Collection } from "#questpie/server/collection/builder/collection.js";
import type {
	CollectionAccess,
	CollectionAccessStorage,
	CollectionBuilderIndexesFn,
	CollectionBuilderState,
	CollectionBuilderTitleFn,
	CollectionHooks,
	CollectionHooksStorage,
	CollectionOptions,
	CollectionTransactionalEffects,
	CollectionTransactionalEffectsStorage,
	EmptyCollectionState,
	RelationConfig,
	TitleExpression,
	UploadOptions,
} from "#questpie/server/collection/builder/types.js";
import type {
	ValidationBuilderOptions,
	ValidationSchemas,
} from "#questpie/server/collection/builder/validation-helpers.js";
import { isInTransaction } from "#questpie/server/collection/crud/shared/transaction.js";
import { ApiError } from "#questpie/server/errors/base.js";
import {
	createFieldsCallbackContext,
	type FieldsCallbackContext,
} from "#questpie/server/fields/builder.js";
import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import type { RelationFieldMetadata } from "#questpie/server/fields/types.js";
import {
	type BuiltinFields,
	builtinFields,
} from "#questpie/server/modules/core/fields/index.js";
import type {
	CrdtOwnerCapability,
	CrdtOwnerConfig,
} from "#questpie/server/modules/core/integrated/crdt/capability.js";
import type { SearchableConfig } from "#questpie/server/modules/core/integrated/search/types.js";
import {
	deleteUnreferencedStorageObject,
	enqueueStorageCleanup,
	lockStorageObjectKey,
	wakeStorageCleanup,
} from "#questpie/server/modules/core/integrated/storage/cleanup-store.js";
import {
	buildStorageFileUrl,
	generateSignedUrlToken,
} from "#questpie/server/modules/core/integrated/storage/signed-url.js";
import type { Override } from "#questpie/shared/type-utils.js";

/**
 * Extract Drizzle column types from field definitions.
 * Maps each field definition to its column type, excluding virtual fields.
 */
type ExtractColumnsFromFieldDefinitions<TFields extends Record<string, any>> = {
	[K in keyof TFields]: FieldColumn<TFields[K]> extends null
		? never
		: FieldColumn<TFields[K]>;
};

// NOTE: the infer parameter must NOT be named TState — the dts bundler
// dedupes type-param names per emitted file, and a collision here renames
// the CollectionBuilder class param to TState$1 in the published d.ts,
// which breaks declaration merging with every generated augmentation
// (TS2428 → collections degrade to any for npm consumers).
type FieldColumn<TField> = TField extends {
	readonly _: infer TFieldState extends FieldState;
}
	? TFieldState["column"]
	: TField extends { $types: { column: infer TColumn } }
		? TColumn
		: never;

/**
 * Extract field types from CollectionBuilderState.
 * Falls back to BuiltinFields if not available.
 *
 * Uses ~fieldTypes phantom property which is set by EmptyCollectionState.
 */

/**
 * Merge field definitions from two collection states without introducing
 * a string index signature. When one side has no fields (keyof resolves to
 * string from the CollectionBuilderState base), use the other side only.
 */
type MergeFieldDefinitions<A, B> = keyof A extends never
	? B
	: keyof B extends never
		? A
		: string extends keyof A
			? B
			: string extends keyof B
				? A
				: A & B;

type ExtractFieldTypes<TState extends CollectionBuilderState> =
	TState["~fieldTypes"] extends infer TFields
		? TFields extends Record<string, any>
			? TFields
			: {} // No fields registered — f will be empty
		: {};

/**
 * Main collection builder class.
 * Uses field builder pattern for type-safe field definitions.
 */
// oxlint-disable-next-line no-unsafe-declaration-merging -- Declaration merging is intentional for extension pattern
export class CollectionBuilder<TState extends CollectionBuilderState> {
	/**
	 * Internal state. Public for type extraction.
	 * Use build() or property accessors instead of accessing this directly.
	 */
	readonly state: TState;
	private _builtCollection?: Collection<TState>;

	// Store callback functions for lazy evaluation
	private _indexesFn?: CollectionBuilderIndexesFn<TState, TState["indexes"]>;

	/**
	 * Runtime field factories map. When provided (by codegen-generated factories),
	 * includes both builtin fields AND module-contributed fields (e.g. richText, blocks).
	 * Falls back to builtinFields when not provided (direct CollectionBuilder usage).
	 */
	private _fieldDefs?: Record<string, any>;

	/**
	 * Create a new CollectionBuilder with the standard empty initial state.
	 *
	 * Encapsulates the hardcoded initial state so that codegen-generated
	 * factories.ts can use `CollectionBuilder.create(name, fieldDefs)` instead of
	 * duplicating the 14-property state object inline.
	 *
	 * @param name - Collection name
	 * @param fieldDefs - Optional runtime field factories map. When provided,
	 *   used instead of builtinFields in `.fields()` callbacks. Codegen-generated
	 *   factory functions pass the merged map (builtins + module-contributed fields).
	 */
	static create<
		TName extends string,
		TFieldTypes extends Record<string, any> = BuiltinFields,
	>(
		name: TName,
		fieldDefs?: Record<string, any>,
	): CollectionBuilder<EmptyCollectionState<TName, undefined, TFieldTypes>> {
		const builder = new CollectionBuilder({
			name: name as string,
			fields: {},
			localized: [],
			virtuals: undefined,
			relations: {},
			indexes: {},
			title: undefined,
			options: {},
			hooks: {},
			transactionalEffects: {},
			access: {},
			searchable: undefined,
			validation: undefined,
			validationOptions: undefined,
			output: undefined,
			upload: undefined,
			collaborative: undefined,
			fieldDefinitions: {},
		});
		if (fieldDefs) {
			builder._fieldDefs = fieldDefs;
		}
		return builder as any;
	}

	constructor(state: TState) {
		this.state = state;
	}

	/**
	 * Define fields using Field Builder.
	 * Provides type-safe field definitions with validation, metadata, and operators.
	 *
	 * Cumulative: fields add to whatever the builder already has (from earlier
	 * `.fields()` calls or `.merge()`) and override existing fields by key —
	 * they never wipe prior state. This makes the documented extension recipe
	 * safe: `collection("user").merge(starterModule.collections.user).fields(...)`
	 * keeps all starter fields and adds yours.
	 *
	 * @example
	 * ```ts
	 * collection("posts").fields(({ f }) => ({
	 *   title: f.text({ required: true }),
	 *   content: f.text({ localized: true }),
	 *   views: f.number({ default: 0 }),
	 * }))
	 * ```
	 */
	fields<const TNewFields extends Record<string, any>>(
		factory: (
			ctx: FieldsCallbackContext<ExtractFieldTypes<TState>>,
		) => TNewFields,
	): CollectionBuilder<
		Override<
			TState,
			{
				fields: MergeFieldDefinitions<
					TState["fields"],
					ExtractColumnsFromFieldDefinitions<TNewFields>
				>;
				localized: readonly string[];
				fieldDefinitions: MergeFieldDefinitions<
					TState["fieldDefinitions"],
					TNewFields
				>;
			}
		>
	>;
	/**
	 * Legacy overload: Define fields using raw Drizzle columns.
	 * @deprecated Use the field builder pattern instead: `.fields(({ f }) => ({ ... }))`
	 *
	 * This overload is kept for backwards compatibility with tests that need
	 * raw Drizzle column features like `.references()` for FK constraints.
	 */
	fields<TNewFields extends Record<string, AnyPgColumn>>(
		columns: TNewFields,
	): CollectionBuilder<
		Override<
			TState,
			{
				fields: MergeFieldDefinitions<TState["fields"], TNewFields>;
				localized: readonly string[];
				fieldDefinitions: TState["fieldDefinitions"];
			}
		>
	>;
	fields<TNewFields>(
		factoryOrColumns:
			| ((ctx: FieldsCallbackContext<ExtractFieldTypes<TState>>) => TNewFields)
			| TNewFields,
	): CollectionBuilder<any> {
		// Check if argument is a function (new pattern) or object (legacy pattern)
		if (typeof factoryOrColumns === "function") {
			// New field builder pattern — V2 factories return Field<TState>
			const factory = factoryOrColumns as (
				ctx: FieldsCallbackContext<ExtractFieldTypes<TState>>,
			) => Record<string, any>;

			const contextProxy = createFieldsCallbackContext(
				this._fieldDefs ?? builtinFields,
			) as unknown as FieldsCallbackContext<ExtractFieldTypes<TState>>;

			const fieldDefs = factory(contextProxy);

			// Extract Drizzle columns and localized field names from field definitions
			// Phase 1: Create all columns first
			const columns: Record<string, any> = {};
			const localizedFields: string[] = [];
			const relationFields: Array<{
				name: string;
				metadata: RelationFieldMetadata;
			}> = [];
			const sqlVirtuals: Record<string, SQL> = {};

			for (const [name, fieldDef] of Object.entries(fieldDefs)) {
				// Check if field is localized (location === "i18n")
				if (fieldDef.getLocation?.() === "i18n") {
					localizedFields.push(name);
				}

				if (fieldDef.getLocation?.() === "virtual") {
					const virtualValue = fieldDef._state?.virtual;
					if (virtualValue && virtualValue !== true) {
						sqlVirtuals[name] = virtualValue as SQL;
					}
				}

				// Collect relation fields for Phase 2
				const metadata = fieldDef.getMetadata?.();
				if (metadata?.type === "relation") {
					relationFields.push({
						name,
						metadata: metadata as RelationFieldMetadata,
					});
				}

				const column = fieldDef.toColumn(name);
				if (column !== null) {
					if (Array.isArray(column)) {
						// Multiple columns (e.g., polymorphic relation with type + id)
						for (const col of column) {
							const colName =
								(col as { name?: string; config?: { name?: string } }).name ??
								(col as { config?: { name?: string } }).config?.name ??
								`${name}_${columns.length}`;
							columns[colName] = col;
						}
					} else {
						// Store column under field name
						// For belongsTo relations, the column is still the FK but key is field name
						// Drizzle casing handles DB column naming (author → author or author_id)
						columns[name] = column;
					}
				}
			}

			// Phase 2: Store relation field metadata for deferred resolution
			// Don't resolve callbacks yet - they reference other collections that may not exist
			// Actual RelationConfig creation happens in build() when all collections are defined
			const pendingRelations: Array<{
				name: string;
				metadata: RelationFieldMetadata;
			}> = relationFields;

			// Cumulative semantics: keep prior fields (from earlier .fields() or
			// .merge()) and override by key. A redefined key fully replaces that
			// field, so its stale per-key state (localized/virtual/relation) is
			// dropped before merging.
			const prevPendingRelations = (
				((this.state as any)._pendingRelations as
					| Array<{ name: string; metadata: RelationFieldMetadata }>
					| undefined) ?? []
			).filter((rel) => !(rel.name in fieldDefs));
			const prevLocalized = (this.state.localized || []).filter(
				(name) => !(name in fieldDefs),
			);
			const prevVirtuals = { ...(this.state.virtuals || {}) };
			for (const name of Object.keys(fieldDefs)) {
				delete prevVirtuals[name];
			}
			const mergedVirtuals = { ...prevVirtuals, ...sqlVirtuals };

			const newState = {
				...this.state,
				fields: { ...this.state.fields, ...columns },
				localized: [...prevLocalized, ...localizedFields],
				fieldDefinitions: {
					...(this.state.fieldDefinitions || {}),
					...fieldDefs,
				},
				virtuals:
					this.state.virtuals === undefined &&
					Object.keys(mergedVirtuals).length === 0
						? undefined
						: mergedVirtuals,
				// Store pending relations for deferred resolution in build()
				_pendingRelations: [...prevPendingRelations, ...pendingRelations],
			} as any;

			const newBuilder = new CollectionBuilder(newState);

			// Copy callback functions
			newBuilder._indexesFn = this._indexesFn;

			return newBuilder;
		}

		// Legacy pattern: raw Drizzle columns object
		const columns = factoryOrColumns as Record<string, AnyPgColumn>;

		// Cumulative like the factory overload. Raw columns are never localized
		// and carry no field definition, so redefined keys drop both.
		const prevFieldDefinitions = {
			...(this.state.fieldDefinitions || {}),
		} as Record<string, any>;
		for (const name of Object.keys(columns)) {
			delete prevFieldDefinitions[name];
		}

		const newState = {
			...this.state,
			fields: { ...this.state.fields, ...columns },
			localized: (this.state.localized || []).filter(
				(name) => !(name in columns),
			),
			fieldDefinitions: prevFieldDefinitions,
			_pendingRelations: (
				((this.state as any)._pendingRelations as
					| Array<{ name: string; metadata: RelationFieldMetadata }>
					| undefined) ?? []
			).filter((rel) => !(rel.name in columns)),
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Convert RelationFieldMetadata to RelationConfig for CRUD operations.
	 */
	private convertRelationMetadataToConfig(
		fieldName: string,
		metadata: RelationFieldMetadata,
		columns: Record<string, any>,
	): RelationConfig | null {
		const { relationType, foreignKey, _toConfig, _throughConfig } = metadata;
		let { targetCollection, through } = metadata;

		// Resolve deferred callbacks now (all collections should be defined by build time)
		if (targetCollection === "__unresolved__" && _toConfig) {
			if (typeof _toConfig === "function") {
				targetCollection = (_toConfig as () => { name: string })().name;
			}
		}
		if (through === "__unresolved__" && _throughConfig) {
			through = (_throughConfig as () => { name: string })().name;
		}

		// Get target collection name (first one for polymorphic)
		let polymorphicTargets: RelationConfig["polymorphicTargets"];
		if (
			relationType === "morphTo" &&
			_toConfig &&
			typeof _toConfig === "object"
		) {
			polymorphicTargets = Object.entries(
				_toConfig as Record<string, string | (() => { name: string })>,
			).map(([discriminator, target]) => {
				let collection: string | undefined;
				if (typeof target === "string") {
					collection = target;
				} else if (typeof target === "function") {
					try {
						collection = target().name;
					} catch {
						collection = undefined;
					}
				}
				return {
					discriminator,
					collection,
					typeField: `${fieldName}Type`,
					idField: `${fieldName}Id`,
				};
			});
		}
		const targetName =
			polymorphicTargets?.find((target) => target.collection)?.collection ??
			(Array.isArray(targetCollection)
				? targetCollection[0]
				: targetCollection);

		// Upload fields (f.upload) populate through the parent row's read
		// decision — see RelationConfig.inheritAccess.
		const inheritAccess = metadata.isUpload === true ? true : undefined;

		switch (relationType) {
			case "belongsTo": {
				// FK column is stored under field name (e.g., "author")
				// Drizzle casing config handles actual DB column naming
				return {
					type: "one",
					collection: targetName,
					fields: columns[fieldName] ? [columns[fieldName]] : undefined,
					references: ["id"],
					relationName: metadata.relationName,
					onDelete: metadata.onDelete,
					onUpdate: metadata.onUpdate,
					inheritAccess,
				};
			}

			case "hasMany": {
				// FK column is on target table
				return {
					type: "many",
					collection: targetName,
					foreignKey,
					references: ["id"],
					relationName: metadata.relationName,
					onDelete: metadata.onDelete,
					onUpdate: metadata.onUpdate,
				};
			}

			case "manyToMany": {
				// Uses junction table
				return {
					type: "manyToMany",
					collection: targetName,
					references: ["id"],
					through: through,
					sourceField: metadata.sourceField,
					targetField: metadata.targetField,
					onDelete: metadata.onDelete,
					onUpdate: metadata.onUpdate,
					inheritAccess,
				};
			}

			case "multiple": {
				// Inline array of FKs - treated like belongsTo for queries
				// but stored as jsonb array
				return {
					type: "one", // Query-wise it's similar to belongsTo
					collection: targetName,
					references: ["id"],
					relationName: metadata.relationName,
					inheritAccess,
				};
			}

			case "morphTo": {
				// Polymorphic - multiple possible targets
				return {
					type: "one",
					collection: targetName,
					polymorphicTargets,
					references: ["id"],
					relationName: metadata.relationName,
					onDelete: metadata.onDelete,
					onUpdate: metadata.onUpdate,
				};
			}

			case "morphMany": {
				// Reverse polymorphic
				return {
					type: "many",
					collection: targetName,
					references: ["id"],
					relationName: metadata.relationName,
				};
			}

			default:
				return null;
		}
	}

	/**
	 * Define indexes and constraints.
	 * Callback receives context object with table.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .indexes(({ table }) => [
	 *     uniqueIndex().on(table.slug),
	 *     index().on(table.createdAt),
	 *   ])
	 * ```
	 */
	indexes<TNewIndexes extends PgTableExtraConfigValue[]>(
		fn: CollectionBuilderIndexesFn<TState, TNewIndexes>,
	): CollectionBuilder<Override<TState, { indexes: TNewIndexes }>> {
		const newState = {
			...this.state,
			indexes: {} as TNewIndexes,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions and set new indexesFn
		newBuilder._indexesFn = fn;

		return newBuilder;
	}

	/** Enable one collaborative aggregate per collection record. */
	collaborative<TAwarenessSchema extends ZodType | undefined = undefined>(
		config?: CrdtOwnerConfig<TAwarenessSchema>,
	): CollectionBuilder<
		Override<TState, { collaborative: CrdtOwnerCapability<TAwarenessSchema> }>
	> {
		const newState = {
			...this.state,
			collaborative: {
				awarenessSchema: config?.awareness,
			},
		} as any;
		const newBuilder = new CollectionBuilder(newState);
		newBuilder._indexesFn = this._indexesFn;
		return newBuilder;
	}

	/**
	 * Define title field (used for _title computed column and display).
	 * Callback receives a field proxy where accessing any field returns its name.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ title: f.text({ required: true }) }))
	 *   .title(({ f }) => f.title)
	 * ```
	 */
	title<TNewTitle extends TitleExpression>(
		fn: CollectionBuilderTitleFn<TState, TNewTitle>,
	): CollectionBuilder<Override<TState, { title: TNewTitle }>> {
		// Create field proxy that returns key name as string
		const fieldProxy = new Proxy({} as any, {
			get: (_target, prop) => prop as string,
		});

		// Execute fn immediately to get the field name
		const titleFieldName = fn({ f: fieldProxy });

		const newState = {
			...this.state,
			title: titleFieldName,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Set collection options (timestamps, softDelete, versioning).
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .options({
	 *     timestamps: true,
	 *     softDelete: true,
	 *     versioning: true,
	 *   })
	 * ```
	 */
	options<TNewOptions extends CollectionOptions>(
		options: TNewOptions,
	): CollectionBuilder<Override<TState, { options: TNewOptions }>> {
		const newState = {
			...this.state,
			options,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Set lifecycle hooks.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .hooks({
	 *     beforeChange: async ({ data, operation }) => {
	 *       if (operation === "create") {
	 *         data.slug = slugify(data.title);
	 *       }
	 *     },
	 *   })
	 * ```
	 */
	hooks<
		TNewHooks extends CollectionHooks<
			CollectionSelect<TState>,
			CollectionInsert<TState>,
			CollectionUpdate<TState>
		>,
	>(
		hooks: TNewHooks,
	): CollectionBuilder<Override<TState, { hooks: CollectionHooksStorage }>> {
		const existingHooks = this.state.hooks;
		const mergedHooks: CollectionHooksStorage = { ...(existingHooks || {}) };

		for (const [hookName, hookValue] of Object.entries(hooks)) {
			const current = mergedHooks[hookName];
			if (!current) {
				mergedHooks[hookName] = hookValue;
				continue;
			}

			const currentArray = Array.isArray(current) ? current : [current];
			const nextArray = Array.isArray(hookValue) ? hookValue : [hookValue];
			mergedHooks[hookName] = [...currentArray, ...nextArray];
		}

		const newState = {
			...this.state,
			hooks: mergedHooks,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Define mandatory application effects that must commit atomically with
	 * the collection mutation.
	 *
	 * Handlers run after the row mutation while the outer transaction remains
	 * open. Any thrown or rejected error propagates and rolls back the row plus
	 * transaction-joined work performed through injected services.
	 */
	transactionalEffects<
		TNewEffects extends CollectionTransactionalEffects<
			CollectionSelect<TState>
		>,
	>(
		effects: TNewEffects,
	): CollectionBuilder<
		Override<
			TState,
			{ transactionalEffects: CollectionTransactionalEffectsStorage }
		>
	> {
		const existingEffects = this.state.transactionalEffects;
		const mergedEffects: CollectionTransactionalEffectsStorage = {
			...(existingEffects || {}),
		};

		for (const [effectName, effectValue] of Object.entries(effects)) {
			const current = mergedEffects[effectName];
			if (!current) {
				mergedEffects[effectName] = effectValue;
				continue;
			}

			const currentArray = Array.isArray(current) ? current : [current];
			const nextArray = Array.isArray(effectValue)
				? effectValue
				: [effectValue];
			mergedEffects[effectName] = [...currentArray, ...nextArray];
		}

		const newBuilder = new CollectionBuilder({
			...this.state,
			transactionalEffects: mergedEffects,
		} as any);
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Set access control rules.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .access({
	 *     read: true,
	 *     create: ({ session }) => session?.user.role === "admin",
	 *     update: ({ session, data }) => session?.user.id === data.authorId,
	 *     delete: ({ session }) => session?.user.role === "admin",
	 *   })
	 * ```
	 */
	access<
		TNewAccess extends CollectionAccess<
			CollectionSelect<TState>,
			CollectionInsert<TState>,
			CollectionUpdate<TState>
		>,
	>(
		access: TNewAccess,
	): CollectionBuilder<Override<TState, { access: CollectionAccessStorage }>> {
		const newState = {
			...this.state,
			access,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Configure search indexing for this collection.
	 * Enables full-text search with BM25 ranking, trigrams, and optional embeddings.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .searchable({
	 *     content: (record) => extractTextFromJson(record.content),
	 *     metadata: (record) => ({ status: record.status }),
	 *     embeddings: async (record, ctx) => await ctx.app.embeddings.generate(text),
	 *   })
	 * ```
	 */
	searchable<TNewSearchable extends SearchableConfig | false>(
		searchable: TNewSearchable,
	): CollectionBuilder<Override<TState, { searchable: TNewSearchable }>> {
		const newState = {
			...this.state,
			searchable,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Configure runtime validation schemas for create/update operations.
	 * Schemas are generated from field definitions automatically.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .validation({
	 *     exclude: { id: true, createdAt: true, updatedAt: true },
	 *     refine: {
	 *       email: (s) => s.email("Invalid email"),
	 *       age: (s) => s.min(0, "Age must be positive"),
	 *     },
	 *   })
	 * ```
	 */
	validation(
		options?: ValidationBuilderOptions,
	): CollectionBuilder<Override<TState, { validation: ValidationSchemas }>> {
		// Record the options and let the Collection constructor build the
		// schemas. Building them here as well is what let the two paths drift:
		// the constructor adds the id, timestamp and soft-delete columns, this
		// one added none, and a stripping Zod object made the difference
		// invisible — `.validation()` quietly removed the ability to pass a
		// custom id on create and to write `deletedAt` on restore. One builder,
		// one place. See test/collection/validation-builder-parity.test.ts.
		const newState = {
			...this.state,
			validationOptions: options ?? {},
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Configure this collection for file uploads.
	 * Automatically:
	 * - Adds upload fields (key, filename, mimeType, size, visibility)
	 * - Extends output type with { url: string } for typed URL access
	 * - Adds afterRead hook for URL generation based on visibility
	 * - Enables upload() and uploadMany() CRUD methods
	 * - Registers HTTP routes: POST /:collection/upload, GET /:collection/files/:key
	 *
	 * @example
	 * ```ts
	 * collection("media")
	 *   .fields(({ f }) => ({
	 *     alt: f.text(),
	 *     folder: f.text(),
	 *   }))
	 *   .upload({
	 *     visibility: "public",
	 *     maxSize: 10_000_000,
	 *     allowedTypes: ["image/*"],
	 *   })
	 * ```
	 */
	upload(options: UploadOptions = {}): CollectionBuilder<
		Override<
			TState,
			{
				fields: TState["fields"] & ReturnType<typeof Collection.uploadCols>;
				output: (TState["output"] extends Record<string, any>
					? TState["output"]
					: {}) & { url: string };
				upload: UploadOptions;
			}
		>
	> {
		// Create upload fields using Collection static method
		const uploadFields = Collection.uploadCols();

		const collectionSlug = this.state.name;
		const isRuntimeSoftDeleteCollection = (app: any) =>
			Object.values(app?.collections ?? {}).some(
				(crud: any) =>
					crud?.["~internalState"]?.name === collectionSlug &&
					crud["~internalState"].options?.softDelete === true,
			);
		const logStorageCleanupError = (
			logger: any,
			message: string,
			key: string,
			error: unknown,
		) => {
			logger?.warn?.(message, {
				key,
				error: error instanceof Error ? error.message : String(error),
			});
		};
		const deleteStorageObjectAfterCommit = async ({
			app,
			key,
			logger,
			onAfterCommit,
			message,
		}: {
			app: any;
			key: string;
			logger: any;
			onAfterCommit?: (callback: () => Promise<void>) => void;
			message: string;
		}) => {
			const cleanup = async () => {
				try {
					await deleteUnreferencedStorageObject({
						app,
						db: app.db,
						key,
						storage: app.storage,
					});
				} catch (error) {
					logStorageCleanupError(logger, message, key, error);
				}
			};

			if (onAfterCommit && isInTransaction()) {
				onAfterCommit(cleanup);
				return;
			}

			await cleanup();
		};
		const uploadAfterReadHook = async ({ data, app }: any) => {
			if (!data?.key) return;

			const baseUrl: string = app.config.app.url;
			const basePath: string = app.config.storage?.basePath || "/";

			let token: string | undefined;
			if ((data.visibility || "public") === "private") {
				const secret: string | undefined = app.config.secret;
				if (!secret) {
					data.url = undefined;
					return;
				}
				const expiration: number =
					app.config.storage?.signedUrlExpiration || 3600;
				token = await generateSignedUrlToken(
					data.key,
					secret,
					expiration,
					collectionSlug,
				);
			}

			data.url = buildStorageFileUrl(
				baseUrl,
				basePath,
				collectionSlug,
				data.key,
				token,
			);
		};

		// Create afterChange hook to sync visibility with storage
		const uploadAfterChangeHook = async ({
			data,
			original,
			app,
			db,
			operation,
			logger,
			onAfterCommit,
		}: any) => {
			if (!app?.storage || !data?.key) return;
			if (operation === "create" || original?.key !== data.key) {
				await lockStorageObjectKey(db, data.key);
				if (!(await app.storage.exists(data.key, { timeout: 30_000 }))) {
					throw ApiError.badRequest(
						`Upload storage object "${data.key}" does not exist`,
					);
				}
			}
			if (operation !== "update") return;
			if (!original?.key || original.key === data.key) return;

			await enqueueStorageCleanup(db, original.key);
			onAfterCommit?.(async () => {
				wakeStorageCleanup(app, logger);
			});
		};

		const uploadAfterDeleteHook = async ({
			data,
			app,
			logger,
			onAfterCommit,
		}: any) => {
			if (!app?.storage || !data?.key) return;
			if (this.state.options.softDelete || isRuntimeSoftDeleteCollection(app)) {
				return;
			}

			await deleteStorageObjectAfterCommit({
				app,
				key: data.key,
				logger,
				onAfterCommit,
				message: "Failed to delete upload file from storage",
			});
		};
		const uploadAfterPurgeHook = async ({
			data,
			app,
			db,
			logger,
			onAfterCommit,
		}: any) => {
			if (!app?.storage || !data?.key) return;

			await enqueueStorageCleanup(db, data.key);
			onAfterCommit?.(async () => {
				wakeStorageCleanup(app, logger);
			});
		};

		// Merge existing afterRead hooks with upload hook
		const existingAfterRead = this.state.hooks?.afterRead;
		const mergedAfterRead = existingAfterRead
			? Array.isArray(existingAfterRead)
				? [...existingAfterRead, uploadAfterReadHook]
				: [existingAfterRead, uploadAfterReadHook]
			: uploadAfterReadHook;

		// Merge existing afterChange hooks with upload hook
		const existingAfterChange = this.state.hooks?.afterChange;
		const mergedAfterChange = existingAfterChange
			? Array.isArray(existingAfterChange)
				? [uploadAfterChangeHook, ...existingAfterChange]
				: [uploadAfterChangeHook, existingAfterChange]
			: uploadAfterChangeHook;
		const existingAfterDelete = this.state.hooks?.afterDelete;
		const mergedAfterDelete = existingAfterDelete
			? Array.isArray(existingAfterDelete)
				? [uploadAfterDeleteHook, ...existingAfterDelete]
				: [uploadAfterDeleteHook, existingAfterDelete]
			: uploadAfterDeleteHook;
		const existingAfterPurge = this.state.hooks?.afterPurge;
		const mergedAfterPurge = existingAfterPurge
			? Array.isArray(existingAfterPurge)
				? [uploadAfterPurgeHook, ...existingAfterPurge]
				: [uploadAfterPurgeHook, existingAfterPurge]
			: uploadAfterPurgeHook;

		const newState = {
			...this.state,
			fields: {
				...this.state.fields,
				...uploadFields,
			},
			output: {
				...(this.state.output || {}),
				url: "" as string,
			},
			hooks: {
				...this.state.hooks,
				afterRead: mergedAfterRead,
				afterChange: mergedAfterChange,
				afterDelete: mergedAfterDelete,
				afterPurge: mergedAfterPurge,
			},
			upload: options,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._indexesFn = this._indexesFn;

		return newBuilder;
	}

	/**
	 * Generic extension point for plugins.
	 * Stores an arbitrary key-value pair in the builder state.
	 * Used by codegen-generated factories to attach admin config, preview config, etc.
	 * without monkey-patching.
	 *
	 * @example
	 * ```ts
	 * // In codegen-generated factory:
	 * collection("posts")
	 *   .fields(({ f }) => ({ title: f.text() }))
	 *   .set("admin", { icon: { type: "icon", props: { name: "ph:article" } } })
	 *   .set("adminList", { view: "collection-table", columns: ["title"] })
	 * ```
	 */
	set<TKey extends string, V>(
		key: TKey,
		value: V,
	): CollectionBuilder<TState & Record<TKey, V>> {
		const newState = { ...this.state, [key]: value } as any;
		const newBuilder = new CollectionBuilder(newState);
		newBuilder._indexesFn = this._indexesFn;
		return newBuilder;
	}

	/**
	 * Build the final collection.
	 * Generates Drizzle tables and sets up all type inference.
	 * Can be called explicitly or happens lazily on first property access.
	 */
	build(): Collection<Prettify<TState>> {
		if (!this._builtCollection) {
			// Resolve pending relations now (all collections should be defined by build time)
			const stateWithResolvedRelations = this.resolveePendingRelations();

			this._builtCollection = new Collection(
				stateWithResolvedRelations,
				this._indexesFn,
			);
		}
		return this._builtCollection;
	}

	/**
	 * Resolve pending relation metadata to RelationConfig.
	 * Called during build() when all collections are defined and callbacks can be safely invoked.
	 */
	private resolveePendingRelations(): TState {
		const pendingRelations = (this.state as any)._pendingRelations as
			| Array<{ name: string; metadata: RelationFieldMetadata }>
			| undefined;

		if (!pendingRelations || pendingRelations.length === 0) {
			return this.state;
		}

		const columns = this.state.fields;
		const resolvedRelations: Record<string, RelationConfig> = {
			...this.state.relations,
		};

		for (const { name, metadata } of pendingRelations) {
			const relationConfig = this.convertRelationMetadataToConfig(
				name,
				metadata,
				columns,
			);
			if (relationConfig) {
				resolvedRelations[name] = relationConfig;
			}
		}

		return {
			...this.state,
			relations: resolvedRelations,
		};
	}

	/**
	 * Lazy build getters - automatically build on first access
	 */
	get table() {
		return this.build().table;
	}

	get i18nTable() {
		return this.build().i18nTable;
	}

	get versionsTable() {
		return this.build().versionsTable;
	}

	get i18nVersionsTable() {
		return this.build().i18nVersionsTable;
	}

	get name(): TState["name"] {
		return this.state.name as TState["name"];
	}

	get $infer() {
		return this.build().$infer;
	}

	/**
	 * Merge another collection builder into this one.
	 * Combines fields, hooks, access control, etc.
	 * Both builders must have the same collection name.
	 */
	merge<TOtherState extends CollectionBuilderState & { name: TState["name"] }>(
		other: CollectionBuilder<TOtherState>,
	): CollectionBuilder<
		Override<
			TState,
			{
				name: TState["name"];
				fields: TState["fields"] & TOtherState["fields"];
				virtuals: TState["virtuals"] & TOtherState["virtuals"];
				relations: TState["relations"] & TOtherState["relations"];
				indexes: TState["indexes"] & TOtherState["indexes"];
				title: TOtherState["title"] extends undefined
					? TState["title"]
					: TOtherState["title"];
				options: TState["options"] & TOtherState["options"];
				hooks: CollectionHooksStorage;
				transactionalEffects: CollectionTransactionalEffectsStorage;
				access: CollectionAccessStorage;
				searchable: TState["searchable"] | TOtherState["searchable"];
				fieldDefinitions: MergeFieldDefinitions<
					TState["fieldDefinitions"],
					TOtherState["fieldDefinitions"]
				>;
				upload: TOtherState["upload"] extends UploadOptions
					? TOtherState["upload"]
					: TState["upload"];
				collaborative: TOtherState["collaborative"] extends CrdtOwnerCapability
					? TOtherState["collaborative"]
					: TState["collaborative"];
				output: (TState["output"] extends Record<string, any>
					? TState["output"]
					: {}) &
					(TOtherState["output"] extends Record<string, any>
						? TOtherState["output"]
						: {});
			}
		>
	> {
		// Merge hooks - combine arrays
		const mergedHooks = this.mergeHooks<
			CollectionSelect<TState> | CollectionSelect<TOtherState>,
			CollectionInsert<TState> | CollectionInsert<TOtherState>,
			CollectionUpdate<TState> | CollectionUpdate<TOtherState>
		>(this.state.hooks as any, other.state.hooks as any);
		const mergedTransactionalEffects = this.mergeTransactionalEffects(
			this.state.transactionalEffects as CollectionTransactionalEffects,
			other.state.transactionalEffects as CollectionTransactionalEffects,
		);

		// Merge access control - other's access overrides this
		const mergedAccess = {
			...this.state.access,
			...other.state.access,
		};

		// Merge pending (unresolved) relations by field name — the plain state
		// spread below would otherwise clobber this side's pending relations
		// with other's. Fields other redefines drop this side's pending entry.
		const thisPendingRelations = (((this.state as any)._pendingRelations as
			| Array<{ name: string; metadata: RelationFieldMetadata }>
			| undefined) ?? []) as Array<{
			name: string;
			metadata: RelationFieldMetadata;
		}>;
		const otherPendingRelations = (((other.state as any)._pendingRelations as
			| Array<{ name: string; metadata: RelationFieldMetadata }>
			| undefined) ?? []) as Array<{
			name: string;
			metadata: RelationFieldMetadata;
		}>;
		const otherFieldKeys = new Set(
			Object.keys(other.state.fieldDefinitions || {}),
		);
		const mergedPendingRelations = [
			...thisPendingRelations.filter((rel) => !otherFieldKeys.has(rel.name)),
			...otherPendingRelations,
		];

		// Spread both states first to preserve extension-set keys (admin, adminList,
		// adminForm, adminActions, adminPreview, etc.) added via .set() — without this
		// they are lost on merge. Then override the explicit merged keys below.
		const mergedState = {
			...this.state,
			...other.state,
			name: this.state.name,
			fields: { ...this.state.fields, ...other.state.fields },
			virtuals: {
				...(this.state.virtuals || {}),
				...(other.state.virtuals || {}),
			},
			relations: {
				...(this.state.relations || {}),
				...(other.state.relations || {}),
			},
			indexes: { ...this.state.indexes, ...other.state.indexes },
			title:
				other.state.title !== undefined ? other.state.title : this.state.title,
			options: { ...this.state.options, ...other.state.options },
			hooks: mergedHooks,
			transactionalEffects: mergedTransactionalEffects,
			access: mergedAccess,
			searchable: other.state.searchable ?? this.state.searchable,
			fieldDefinitions: {
				...(this.state.fieldDefinitions || {}),
				...(other.state.fieldDefinitions || {}),
			},
			upload: other.state.upload ?? this.state.upload,
			collaborative: other.state.collaborative ?? this.state.collaborative,
			output: {
				...(this.state.output || {}),
				...(other.state.output || {}),
			},
			localized: [
				...(this.state.localized || []),
				...(other.state.localized || []),
			],
			validation: other.state.validation ?? this.state.validation,
			validationOptions:
				other.state.validationOptions ?? this.state.validationOptions,
			_pendingRelations: mergedPendingRelations,
		} as any;

		const newBuilder = new CollectionBuilder(mergedState);

		// Merge callback functions - prefer other's if exists, otherwise use this
		newBuilder._indexesFn = other._indexesFn || this._indexesFn;

		return newBuilder;
	}

	/**
	 * Helper to merge hooks - combines hook arrays
	 */
	private mergeHooks<TSelect = any, TInsert = any, TUpdate = any>(
		hooks1: CollectionHooks<TSelect, TInsert, TUpdate>,
		hooks2: CollectionHooks<TSelect, TInsert, TUpdate>,
	): CollectionHooks<TSelect, TInsert, TUpdate> {
		const merged: CollectionHooks<TSelect, TInsert, TUpdate> = {};

		const hookKeys = Array.from(
			new Set([...Object.keys(hooks1 || {}), ...Object.keys(hooks2 || {})]),
		) as (keyof CollectionHooks)[];

		for (const key of hookKeys) {
			const hook1 = hooks1?.[key];
			const hook2 = hooks2?.[key];

			if (!hook1 && !hook2) continue;
			if (!hook1) {
				merged[key] = hook2 as any;
				continue;
			}
			if (!hook2) {
				merged[key] = hook1 as any;
				continue;
			}

			// Both exist - combine into array
			const arr1 = Array.isArray(hook1) ? hook1 : [hook1];
			const arr2 = Array.isArray(hook2) ? hook2 : [hook2];
			merged[key] = [...arr1, ...arr2] as any;
		}

		return merged;
	}

	private mergeTransactionalEffects(
		effects1: CollectionTransactionalEffects,
		effects2: CollectionTransactionalEffects,
	): CollectionTransactionalEffects {
		const merged: CollectionTransactionalEffects = {};
		const effectKeys = Array.from(
			new Set([...Object.keys(effects1 || {}), ...Object.keys(effects2 || {})]),
		) as (keyof CollectionTransactionalEffects)[];

		for (const key of effectKeys) {
			const effect1 = effects1?.[key];
			const effect2 = effects2?.[key];
			if (!effect1 && !effect2) continue;
			if (!effect1) {
				merged[key] = effect2 as any;
				continue;
			}
			if (!effect2) {
				merged[key] = effect1 as any;
				continue;
			}
			const first = Array.isArray(effect1) ? effect1 : [effect1];
			const second = Array.isArray(effect2) ? effect2 : [effect2];
			merged[key] = [...first, ...second] as any;
		}

		return merged;
	}
}

/**
 * Factory function to create a new collection builder.
 *
 * @example
 * ```ts
 * const posts = collection("posts").fields(({ f }) => ({
 *   title: f.text({ required: true }),
 *   content: f.text({ localized: true }),
 * }));
 * ```
 */
export function collection<TName extends string>(
	name: TName,
): CollectionBuilder<EmptyCollectionState<TName, undefined, BuiltinFields>> {
	return new CollectionBuilder({
		name: name as string,
		fields: {},
		localized: [],
		virtuals: undefined,
		relations: {},
		indexes: {},
		title: undefined,
		options: {},
		hooks: {},
		transactionalEffects: {},
		access: {},
		searchable: undefined,
		validation: undefined,
		validationOptions: undefined,
		output: undefined,
		upload: undefined,
		collaborative: undefined,
		fieldDefinitions: {},
	}) as any;
}
