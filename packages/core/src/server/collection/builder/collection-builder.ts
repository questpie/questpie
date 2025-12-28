import { Collection } from "#questpie/core/server/collection/builder/collection";
import type {
	CollectionAccess,
	CollectionBuilderState,
	CollectionHooks,
	CollectionOptions,
	I18nFieldAccessor,
	InferColumnsFromFields,
	InferTableWithColumns,
	NonLocalizedFields,
	RelationConfig,
	EmptyCollectionState,
	CollectionBuilderRelationFn,
} from "#questpie/core/server/collection/builder/types";
import type { CRUD } from "#questpie/core/server/collection/crud/types";
import type { BuildExtraConfigColumns, SQL } from "drizzle-orm";
import type { PgTableExtraConfigValue } from "drizzle-orsearch";

/**
 * Main collection builder class
 * Uses Drizzle-style single generic pattern for better type performance
 */
export class CollectionBuilder<TState extends CollectionBuilderState> {
	private state: TState;
	private _builtCollection?: Collection<TState>;

	// Store callback functions for lazy evaluation
	private _virtualsFn?: (
		table: any,
		i18n: any,
		context: any,
	) => TState["virtuals"];
	private _relationsFn?: CollectionBuilderRelationFn<TState, any>;
	private _indexesFn?: (table: any) => TState["indexes"];
	private _titleFn?: (table: any, i18n: any, context: any) => TState["title"];

	constructor(state: TState) {
		this.state = state;
	}

	/**
	 * Define fields using Drizzle column definitions
	 * This carries forward the exact Drizzle types for full type safety
	 * Accepts column builders - Drizzle will convert them when creating the table
	 */
	fields<TNewFields extends Record<string, any>>(
		fields: TNewFields,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TNewFields,
			[], // Reset localized when fields change
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			fields,
			localized: [] as any,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Mark fields as localized (moved to i18n table)
	 * Type safety: only allows keys that exist in fields
	 */
	localized<TKeys extends ReadonlyArray<keyof TState["fields"]>>(
		keys: TKeys,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TKeys,
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			localized: keys,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Define virtual (computed) fields
	 * Callback receives fully typed table + i18n accessor for localized fields
	 */
	virtuals<TNewVirtuals extends Record<string, SQL>>(
		fn: (
			table: InferTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				undefined,
				TState["options"]
			>,
			i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>,
			context: any,
		) => TNewVirtuals,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TNewVirtuals,
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			virtuals: {} as TNewVirtuals, // Populated during build()
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions and set new virtualsFn
		newBuilder._virtualsFn = fn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Define relations to other collections
	 */
	relations<TNewRelations extends Record<string, RelationConfig>>(
		fn: CollectionBuilderRelationFn<TState, TNewRelations>,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TNewRelations,
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			relations: {} as TNewRelations,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions and set new relationsFn
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = fn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Define indexes and constraints
	 * Callback receives fully typed table
	 */
	indexes<TNewIndexes extends PgTableExtraConfigValue[]>(
		fn: (
			table: BuildExtraConfigColumns<
				TState["name"],
				InferColumnsFromFields<
					TState["fields"],
					TState["options"],
					TState["title"]
				>,
				"pg"
			>,
		) => TNewIndexes,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TNewIndexes,
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			indexes: {} as TNewIndexes,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions and set new indexesFn
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = fn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Define title expression (creates searchable _title column)
	 * Can reference both non-localized fields and localized fields via i18n accessor
	 */
	title<TNewTitle extends SQL>(
		fn: (
			table: InferTableWithColumns<
				TState["name"],
				NonLocalizedFields<TState["fields"], TState["localized"]>,
				undefined,
				TState["options"]
			>,
			i18n: I18nFieldAccessor<TState["fields"], TState["localized"]>,
			context: any,
		) => TNewTitle,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TNewTitle,
			TState["options"],
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			title: undefined as any,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy existing callback functions and set new titleFn
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = fn;

		return newBuilder;
	}

	/**
	 * Set collection options (timestamps, softDelete, tableName)
	 */
	options<TNewOptions extends CollectionOptions>(
		options: TNewOptions,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TNewOptions,
			TState["hooks"],
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			options,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Set lifecycle hooks
	 */
	hooks<TNewHooks extends CollectionHooks>(
		hooks: TNewHooks,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TNewHooks,
			TState["access"],
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			hooks,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Set access control rules
	 */
	access<TNewAccess extends CollectionAccess>(
		access: TNewAccess,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TNewAccess,
			TState["searchable"]
		>
	> {
		const newState = {
			...this.state,
			access,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Configure search indexing for this collection
	 * Enables full-text search with BM25 ranking, trigrams, and optional embeddings
	 *
	 * @example
	 * .searchable({
	 *   content: (record) => extractTextFromJson(record.content),
	 *   metadata: (record) => ({ status: record.status }),
	 *   embeddings: async (record, ctx) => await ctx.cms.embeddings.generate(text)
	 * })
	 */
	searchable<TNewSearchable extends SearchableConfig>(
		searchable: TNewSearchable,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"],
			TState["localized"],
			TState["virtuals"],
			TState["relations"],
			TState["indexes"],
			TState["title"],
			TState["options"],
			TState["hooks"],
			TState["access"],
			TNewSearchable
		>
	> {
		const newState = {
			...this.state,
			searchable,
		} as any;

		const newBuilder = new CollectionBuilder(newState);

		// Copy callback functions
		newBuilder._virtualsFn = this._virtualsFn;
		newBuilder._relationsFn = this._relationsFn;
		newBuilder._indexesFn = this._indexesFn;
		newBuilder._titleFn = this._titleFn;

		return newBuilder;
	}

	/**
	 * Build the final collection
	 * Generates Drizzle tables and sets up all type inference
	 * Can be called explicitly or happens lazily on first property access
	 */
	build(): Collection<TState> {
		if (!this._builtCollection) {
			this._builtCollection = new Collection(
				this.state,
				this._virtualsFn,
				this._relationsFn,
				this._indexesFn,
				this._titleFn,
			);
		}
		return this._builtCollection;
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
	get name() {
		return this.state.name;
	}

	get $infer() {
		return this.build().$infer;
	}

	/**
	 * Proxy methods to built collection
	 */
	generateCRUD(db: any, cms?: any) {
		return this.build().generateCRUD(db, cms);
	}

	getMeta() {
		return this.build().getMeta();
	}

	getVirtuals(context: any) {
		return this.build().getVirtuals(context);
	}

	getTitle(context: any) {
		return this.build().getTitle(context);
	}

	getRawTitle(context: any) {
		return this.build().getRawTitle(context);
	}

	/**
	 * Merge another collection builder into this one
	 * Combines fields, hooks, access control, etc.
	 * Both builders must have the same collection name
	 */
	merge<
		TOtherState extends CollectionBuilderState<
			TState["name"],
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any,
			any
		>,
	>(
		other: CollectionBuilder<TOtherState>,
	): CollectionBuilder<
		CollectionBuilderState<
			TState["name"],
			TState["fields"] & TOtherState["fields"],
			TState["localized"] | TOtherState["localized"],
			TState["virtuals"] & TOtherState["virtuals"],
			TState["relations"] & TOtherState["relations"],
			TState["indexes"] & TOtherState["indexes"],
			TOtherState["title"] extends undefined
				? TState["title"]
				: TOtherState["title"], // Other's title overrides
			TState["options"] & TOtherState["options"],
			CollectionHooks, // Merged hooks
			CollectionAccess // Merged access
		>
	> {
		// Merge hooks - combine arrays
		const mergedHooks = this.mergeHooks(this.state.hooks, other.state.hooks);

		// Merge access control - other's access overrides this
		const mergedAccess = {
			...this.state.access,
			...other.state.access,
			fields: {
				...this.state.access?.fields,
				...other.state.access?.fields,
			},
		};

		const mergedState = {
			name: this.state.name,
			fields: { ...this.state.fields, ...other.state.fields },
			localized: [...this.state.localized, ...other.state.localized] as any,
			virtuals: { ...this.state.virtuals, ...other.state.virtuals },
			relations: { ...this.state.relations, ...other.state.relations },
			indexes: { ...this.state.indexes, ...other.state.indexes },
			title:
				other.state.title !== undefined ? other.state.title : this.state.title,
			options: { ...this.state.options, ...other.state.options },
			hooks: mergedHooks,
			access: mergedAccess,
		} as any;

		const newBuilder = new CollectionBuilder(mergedState);

		// Merge callback functions - prefer other's if exists, otherwise use this
		newBuilder._virtualsFn = other._virtualsFn || this._virtualsFn;
		newBuilder._relationsFn = other._relationsFn || this._relationsFn;
		newBuilder._indexesFn = other._indexesFn || this._indexesFn;
		newBuilder._titleFn = other._titleFn || this._titleFn;

		return newBuilder;
	}

	/**
	 * Helper to merge hooks - combines hook arrays
	 */
	private mergeHooks(
		hooks1: CollectionHooks,
		hooks2: CollectionHooks,
	): CollectionHooks {
		const merged: CollectionHooks = {};

		// All possible hook keys
		const hookKeys = new Set([
			...Object.keys(hooks1 || {}),
			...Object.keys(hooks2 || {}),
		]) as Set<keyof CollectionHooks>;

		for (const key of hookKeys) {
			const hook1 = hooks1?.[key];
			const hook2 = hooks2?.[key];

			if (!hook1 && !hook2) continue;
			if (!hook1) {
				merged[key] = hook2;
				continue;
			}
			if (!hook2) {
				merged[key] = hook1;
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
 * Factory function to create a new collection builder
 */
export function defineCollection<TName extends string>(
	name: TName,
): CollectionBuilder<EmptyCollectionState<TName>> {
	return new CollectionBuilder({
		name,
		fields: {},
		localized: [],
		virtuals: {},
		relations: {},
		indexes: {},
		title: undefined,
		options: {},
		hooks: {},
		access: {},
		searchable: undefined,
	});
}
