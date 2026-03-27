import type { Prettify } from "better-auth";
import type { SQL } from "drizzle-orm";
import type { AnyPgColumn, PgTableExtraConfigValue } from "drizzle-orm/pg-core";
import type { z } from "zod";

import type {
	CollectionInsert,
	CollectionSelect,
	CollectionUpdate,
} from "#questpie/server/collection/builder/collection.js";
import { Collection } from "#questpie/server/collection/builder/collection.js";
import type {
	CollectionAccess,
	CollectionBuilderIndexesFn,
	CollectionBuilderState,
	CollectionBuilderTitleFn,
	CollectionHooks,
	CollectionOptions,
	EmptyCollectionState,
	RelationConfig,
	TitleExpression,
	UploadOptions,
} from "#questpie/server/collection/builder/types.js";
import {
	createCollectionValidationSchemas,
	type ValidationSchemas,
} from "#questpie/server/collection/builder/validation-helpers.js";
import type { StorageVisibility } from "#questpie/server/config/types.js";
import {
	createFieldsCallbackContext,
	type FieldsCallbackContext,
} from "#questpie/server/fields/builder.js";
import {
	type BuiltinFields,
	builtinFields,
} from "#questpie/server/fields/builtin/defaults.js";
import type { RelationFieldMetadata } from "#questpie/server/fields/types.js";
import type { SearchableConfig } from "#questpie/server/integrated/search/index.js";
import type { Override } from "#questpie/shared/type-utils.js";

/**
 * Extract Drizzle column types from field definitions.
 * Maps each field definition to its column type, excluding virtual fields.
 */
type ExtractColumnsFromFieldDefinitions<TFields extends Record<string, any>> = {
	[K in keyof TFields]: TFields[K]["$types"]["column"] extends null
		? never
		: TFields[K]["$types"]["column"];
};

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
			access: {},
			searchable: undefined,
			validation: undefined,
			output: undefined,
			upload: undefined,
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
				fields: ExtractColumnsFromFieldDefinitions<TNewFields>;
				localized: readonly string[];
				fieldDefinitions: TNewFields;
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
				fields: TNewFields;
				localized: readonly string[];
				fieldDefinitions: {};
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
								(col as { name?: string }).name ?? `${name}_${columns.length}`;
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

			const newState = {
				...this.state,
				fields: columns,
				localized: localizedFields,
				fieldDefinitions: fieldDefs,
				virtuals:
					Object.keys(sqlVirtuals).length > 0
						? {
								...(this.state.virtuals || {}),
								...sqlVirtuals,
							}
						: this.state.virtuals,
				// Store pending relations for deferred resolution in build()
				_pendingRelations: pendingRelations,
			} as any;

			const newBuilder = new CollectionBuilder(newState);

			// Copy callback functions
			newBuilder._indexesFn = this._indexesFn;

			return newBuilder;
		}

		// Legacy pattern: raw Drizzle columns object
		const columns = factoryOrColumns as Record<string, AnyPgColumn>;

		const newState = {
			...this.state,
			fields: columns,
			localized: [],
			fieldDefinitions: {},
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
		const targetName = Array.isArray(targetCollection)
			? targetCollection[0]
			: targetCollection;

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
				};
			}

			case "hasMany": {
				// FK column is on target table
				return {
					type: "many",
					collection: targetName,
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
				};
			}

			case "morphTo": {
				// Polymorphic - multiple possible targets
				// For now, use first target for basic relation resolution
				return {
					type: "one",
					collection: targetName,
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
	): CollectionBuilder<Override<TState, { hooks: Record<string, any> }>> {
		const existingHooks = this.state.hooks;
		const mergedHooks: Record<string, any> = { ...(existingHooks || {}) };

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
	 * Set access control rules.
	 *
	 * @example
	 * ```ts
	 * collection("posts")
	 *   .fields(({ f }) => ({ ... }))
	 *   .access({
	 *     read: true,
	 *     create: ({ user }) => user?.role === "admin",
	 *     update: ({ user, id }) => user?.id === id,
	 *     delete: ({ user }) => user?.role === "admin",
	 *   })
	 * ```
	 */
	access<TNewAccess extends CollectionAccess<CollectionSelect<TState>>>(
		access: TNewAccess,
	): CollectionBuilder<Override<TState, { access: Record<string, any> }>> {
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
	searchable<TNewSearchable extends SearchableConfig>(
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
	validation(options?: {
		/** Fields to exclude from validation (e.g., id, timestamps) */
		exclude?: Record<string, true>;
		/** Custom refinements per field */
		refine?: Record<string, (schema: z.ZodTypeAny) => z.ZodTypeAny>;
	}): CollectionBuilder<Override<TState, { validation: ValidationSchemas }>> {
		// Extract main and localized fields from field definitions
		const mainFields: Record<string, any> = {};
		const localizedFields: Record<string, any> = {};

		if (this.state.fieldDefinitions) {
			for (const [key, fieldDef] of Object.entries(
				this.state.fieldDefinitions,
			)) {
				const column = this.state.fields[key];
				if (!column) continue;

				if (fieldDef.getLocation?.() === "i18n") {
					localizedFields[key] = column;
				} else {
					mainFields[key] = column;
				}
			}
		}

		// Generate validation schemas
		const validationSchemas = createCollectionValidationSchemas(
			this.state.name,
			mainFields,
			localizedFields,
			options,
		);

		const newState = {
			...this.state,
			validation: validationSchemas,
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

		// Create afterRead hook for URL generation
		const uploadAfterReadHook = async ({ data, app }: any) => {
			if (!app?.storage || !data?.key) return;

			const fileVisibility: StorageVisibility = data.visibility || "public";

			if (fileVisibility === "private") {
				data.url = await app.storage.use().getSignedUrl(data.key);
			} else {
				data.url = await app.storage.use().getUrl(data.key);
			}
		};

		// Create afterChange hook to sync visibility with storage
		const uploadAfterChangeHook = async ({
			data,
			original,
			app,
			operation,
		}: any) => {
			if (operation !== "update") return;
			if (!app?.storage || !data?.key) return;
			if (!original || original.visibility === data.visibility) return;

			await app.storage.use().setVisibility(data.key, data.visibility);
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
				? [...existingAfterChange, uploadAfterChangeHook]
				: [existingAfterChange, uploadAfterChangeHook]
			: uploadAfterChangeHook;

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
				hooks: Record<string, any>;
				access: Record<string, any>;
				searchable: TState["searchable"] | TOtherState["searchable"];
				fieldDefinitions: MergeFieldDefinitions<
					TState["fieldDefinitions"],
					TOtherState["fieldDefinitions"]
				>;
				upload: TOtherState["upload"] extends UploadOptions
					? TOtherState["upload"]
					: TState["upload"];
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

		// Merge access control - other's access overrides this
		const mergedAccess = {
			...this.state.access,
			...other.state.access,
		};

		const mergedState = {
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
			access: mergedAccess,
			searchable: other.state.searchable ?? this.state.searchable,
			fieldDefinitions: {
				...(this.state.fieldDefinitions || {}),
				...(other.state.fieldDefinitions || {}),
			},
			upload: other.state.upload ?? this.state.upload,
			output: {
				...(this.state.output || {}),
				...(other.state.output || {}),
			},
			localized: [
				...(this.state.localized || []),
				...(other.state.localized || []),
			],
			validation: other.state.validation ?? this.state.validation,
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
		access: {},
		searchable: undefined,
		validation: undefined,
		output: undefined,
		upload: undefined,
		fieldDefinitions: {},
	}) as any;
}
