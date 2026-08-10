import type { SQL } from "drizzle-orm";
import type { ZodType } from "zod";

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import {
	createFieldsCallbackContext,
	type FieldsCallbackContext,
} from "#questpie/server/fields/builder.js";
import type { RelationFieldMetadata } from "#questpie/server/fields/types.js";
import { Global } from "#questpie/server/global/builder/global.js";
import type {
	EmptyGlobalState,
	GlobalAccess,
	GlobalBuilderState,
	GlobalHooks,
	GlobalOptions,
} from "#questpie/server/global/builder/types.js";
import {
	type BuiltinFields,
	builtinFields,
} from "#questpie/server/modules/core/fields/index.js";
import type {
	CrdtOwnerCapability,
	CrdtOwnerConfig,
} from "#questpie/server/modules/core/integrated/crdt/capability.js";
import type { Override, Prettify } from "#questpie/shared/type-utils.js";

function withCollaborativeSnapshotPolicy<T extends GlobalOptions>(
	options: T,
): T {
	if (!options.versioning) return options;
	const versioning = options.versioning === true ? {} : options.versioning;
	return {
		...options,
		versioning: {
			...versioning,
			collaborativeSnapshots: "checkpoint",
		},
	} as T;
}

/**
 * Extract Drizzle column types from field definitions.
 */
type ExtractColumnsFromFieldDefinitions<TFields extends Record<string, any>> = {
	[K in keyof TFields]: TFields[K]["$types"]["column"] extends null
		? never
		: TFields[K]["$types"]["column"];
};

/**
 * Merge field definitions from two global states without introducing a
 * string index signature (twin of the CollectionBuilder helper). When one
 * side has no fields (keyof resolves to string from the state base), use
 * the other side only.
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

/**
 * Extract field types from GlobalBuilderState.
 * Falls back to BuiltinFields if not available.
 *
 * Uses ~fieldTypes phantom property which is set by EmptyGlobalState.
 */
type ExtractFieldTypes<TState extends GlobalBuilderState> =
	TState["~fieldTypes"] extends infer TFields
		? TFields extends Record<string, any>
			? TFields
			: {} // No fields registered — f will be empty
		: {};

/**
 * Main global builder class
 */
// oxlint-disable-next-line no-unsafe-declaration-merging -- Declaration merging is intentional for extension pattern
export class GlobalBuilder<TState extends GlobalBuilderState> {
	readonly state: TState;
	private _builtGlobal?: Global<TState>;

	/**
	 * Runtime field factories map. When provided (by codegen-generated factories),
	 * includes both builtin fields AND module-contributed fields (e.g. richText, blocks).
	 * Falls back to builtinFields when not provided (direct GlobalBuilder usage).
	 */
	private _fieldDefs?: Record<string, any>;

	/**
	 * Create a new GlobalBuilder with the standard empty initial state.
	 *
	 * Encapsulates the hardcoded initial state so that codegen-generated
	 * factories.ts can use `GlobalBuilder.create(name, fieldDefs)` instead of
	 * duplicating the 9-property state object inline.
	 *
	 * @param name - Global name
	 * @param fieldDefs - Optional runtime field factories map. When provided,
	 *   used instead of builtinFields in `.fields()` callbacks. Codegen-generated
	 *   factory functions pass the merged map (builtins + module-contributed fields).
	 */
	static create<
		TName extends string,
		TFieldTypes extends Record<string, any> | undefined = BuiltinFields,
	>(
		name?: TName,
		fieldDefs?: Record<string, any>,
	): GlobalBuilder<EmptyGlobalState<TName, undefined, TFieldTypes>> {
		const builder = new GlobalBuilder({
			name: name as string,
			fields: {},
			localized: [],
			virtuals: {},
			relations: {},
			options: {},
			hooks: {},
			access: {},
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
	 * Build the next builder in an immutable chain, carrying private state
	 * forward.
	 *
	 * `_fieldDefs` — the app's field-factory map, holding module-contributed
	 * types like `richText` — was assigned once in `create()` and carried by
	 * none of the derivations, so the first `.set()` or `.options()` dropped it
	 * and `.fields()` silently fell back to `builtinFields` while the type still
	 * advertised the full map. Same defect as CollectionBuilder had; one place
	 * to fix it, and one place to extend when a private field is added.
	 */
	private _derive<TNext extends GlobalBuilderState>(
		state: TNext,
	): GlobalBuilder<TNext> {
		const next = new GlobalBuilder(state);
		next._fieldDefs = this._fieldDefs;
		return next;
	}

	/**
	 * Define fields using Field Builder.
	 *
	 * Cumulative: fields add to whatever the builder already has from earlier
	 * `.fields()` calls and override existing fields by key — they never wipe
	 * prior state (same semantics as CollectionBuilder.fields()).
	 *
	 * @example
	 * ```ts
	 * global("settings").fields(({ f }) => ({
	 *   siteName: f.text({ required: true }),
	 * }))
	 * ```
	 */
	fields<const TNewFields extends Record<string, any>>(
		factory: (
			ctx: FieldsCallbackContext<ExtractFieldTypes<TState>>,
		) => TNewFields,
	): GlobalBuilder<
		Override<
			TState,
			{
				fields: MergeFieldDefinitions<
					TState["fields"],
					ExtractColumnsFromFieldDefinitions<TNewFields>
				>;
				localized: [];
				fieldDefinitions: MergeFieldDefinitions<
					TState["fieldDefinitions"],
					TNewFields
				>;
			}
		>
	>;

	/**
	 * Define fields using raw Drizzle column definitions.
	 */
	fields<TNewFields extends Record<string, any>>(
		// Exclude functions from this overload
		fields: TNewFields extends (...args: any[]) => any ? never : TNewFields,
	): GlobalBuilder<
		Override<
			TState,
			{
				fields: MergeFieldDefinitions<TState["fields"], TNewFields>;
				localized: [];
				fieldDefinitions: TState["fieldDefinitions"];
			}
		>
	>;

	// Implementation
	fields<TNewFields extends Record<string, any>>(
		fieldsOrFactory:
			| TNewFields
			| ((ctx: FieldsCallbackContext<any>) => TNewFields),
	): GlobalBuilder<any> {
		let columns: Record<string, any>;
		let virtuals: Record<string, SQL> = {};
		let fieldDefinitions: Record<string, any> | undefined;
		const pendingRelations: Array<{
			name: string;
			metadata: RelationFieldMetadata;
		}> = [];
		const localizedFields: string[] = [];

		if (typeof fieldsOrFactory === "function") {
			const contextProxy = createFieldsCallbackContext(
				this._fieldDefs ?? builtinFields,
			) as unknown as FieldsCallbackContext<ExtractFieldTypes<TState>>;

			const fieldDefs = fieldsOrFactory(contextProxy);
			fieldDefinitions = fieldDefs;

			// Extract Drizzle columns from field definitions
			columns = {};
			for (const [name, fieldDef] of Object.entries(fieldDefs)) {
				// Check if field is localized (location === "i18n")
				if (fieldDef.getLocation?.() === "i18n") {
					localizedFields.push(name);
				}

				if (fieldDef.getLocation?.() === "virtual") {
					const virtualValue = fieldDef._state?.virtual;
					if (virtualValue && virtualValue !== true) {
						virtuals[name] = virtualValue as SQL;
					}
				}

				// Collect relation fields for deferred resolution
				const metadata = fieldDef.getMetadata?.();
				if (metadata?.type === "relation") {
					pendingRelations.push({
						name,
						metadata: metadata as RelationFieldMetadata,
					});
				}

				const column = fieldDef.toColumn(name);
				if (column !== null) {
					if (Array.isArray(column)) {
						for (const col of column) {
							const colName =
								(col as { name?: string }).name ??
								`${name}_${Object.keys(columns).length}`;
							columns[colName] = col;
						}
					} else {
						// For globals, use the field name directly as column name
						columns[name] = column;
					}
				}
			}

			// Cumulative semantics: merge with prior virtuals, but drop entries
			// for keys redefined in this call (they may no longer be virtual).
			const prevVirtuals = { ...(this.state.virtuals || {}) };
			for (const name of Object.keys(fieldDefs)) {
				delete prevVirtuals[name];
			}
			virtuals = {
				...prevVirtuals,
				...virtuals,
			};
		} else {
			// Raw Drizzle columns
			columns = fieldsOrFactory;
			virtuals = { ...(this.state.virtuals || {}) };
			for (const name of Object.keys(columns)) {
				delete virtuals[name];
			}
			fieldDefinitions = undefined;
		}

		// Cumulative semantics (same as CollectionBuilder.fields()): keep prior
		// fields and override by key. A redefined key fully replaces that field,
		// so its stale per-key state (localized/relation/definition) is dropped.
		const incomingFieldNames = fieldDefinitions
			? Object.keys(fieldDefinitions)
			: Object.keys(columns);
		const prevLocalized = (this.state.localized || []).filter(
			(name) => !incomingFieldNames.includes(name),
		);
		const prevPendingRelations = (
			((this.state as any)._pendingRelations as
				| Array<{ name: string; metadata: RelationFieldMetadata }>
				| undefined) ?? []
		).filter((rel) => !incomingFieldNames.includes(rel.name));
		const prevFieldDefinitions = {
			...(this.state.fieldDefinitions || {}),
		} as Record<string, any>;
		for (const name of incomingFieldNames) {
			delete prevFieldDefinitions[name];
		}

		const newState = {
			...this.state,
			fields: { ...this.state.fields, ...columns },
			localized: [...prevLocalized, ...localizedFields],
			virtuals,
			fieldDefinitions: fieldDefinitions
				? { ...prevFieldDefinitions, ...fieldDefinitions }
				: this.state.fieldDefinitions
					? prevFieldDefinitions
					: undefined,
			_pendingRelations: [...prevPendingRelations, ...pendingRelations],
		} as any;

		return this._derive(newState);
	}

	/** Enable one collaborative aggregate for this global singleton/scope. */
	collaborative<TAwarenessSchema extends ZodType | undefined = undefined>(
		config?: CrdtOwnerConfig<TAwarenessSchema>,
	): GlobalBuilder<
		Override<
			TState,
			{
				collaborative: CrdtOwnerCapability<TAwarenessSchema>;
				options: TState["options"] & { optimisticConcurrency: true };
			}
		>
	> {
		const newState = {
			...this.state,
			options: withCollaborativeSnapshotPolicy({
				...this.state.options,
				optimisticConcurrency: true,
			}),
			collaborative: {
				awarenessSchema: config?.awareness,
			},
		} as any;
		return this._derive(newState);
	}

	/**
	 * Set global options
	 */
	options<TNewOptions extends GlobalOptions>(
		options: TNewOptions,
	): GlobalBuilder<
		Override<
			TState,
			{
				options: TState["collaborative"] extends CrdtOwnerCapability<any>
					? TNewOptions & { optimisticConcurrency: true }
					: TNewOptions;
			}
		>
	> {
		const newState = {
			...this.state,
			options: this.state.collaborative
				? withCollaborativeSnapshotPolicy({
						...options,
						optimisticConcurrency: true,
					})
				: options,
		} as any;

		return this._derive(newState);
	}

	/**
	 * Set lifecycle hooks
	 */
	hooks<TNewHooks extends GlobalHooks<any>>(
		hooks: TNewHooks,
	): GlobalBuilder<Override<TState, { hooks: Record<string, any> }>> {
		const newState = {
			...this.state,
			hooks,
		} as any;

		return this._derive(newState);
	}

	/**
	 * Set access control rules
	 */
	access<
		TNewAccess extends GlobalAccess<
			Global<TState>["$infer"]["select"],
			Global<TState>["$infer"]["update"]
		>,
	>(
		access: TNewAccess,
	): GlobalBuilder<Override<TState, { access: Record<string, any> }>> {
		const newState = {
			...this.state,
			access,
		} as any;

		return this._derive(newState);
	}

	/**
	 * Convert RelationFieldMetadata to RelationConfig for CRUD operations.
	 * Similar to collection builder's convertRelationMetadataToConfig.
	 */
	private convertRelationMetadataToConfig(
		fieldName: string,
		metadata: RelationFieldMetadata,
		columns: Record<string, any>,
	): RelationConfig | null {
		const { relationType, _toConfig, _throughConfig } = metadata;
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
				// For globals, FK column name is the same as field name
				const fkColumnName = fieldName;
				return {
					type: "one",
					collection: targetName,
					fields: columns[fkColumnName] ? [columns[fkColumnName]] : undefined,
					references: ["id"],
					relationName: metadata.relationName,
					onDelete: metadata.onDelete,
					onUpdate: metadata.onUpdate,
				};
			}

			case "hasMany": {
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

			default:
				return null;
		}
	}

	/**
	 * Resolve pending relation metadata to RelationConfig.
	 */
	private resolvePendingRelations(): TState {
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
	 * Generic extension point for plugins.
	 * Stores an arbitrary key-value pair in the builder state.
	 */
	set<TKey extends string, V>(
		key: TKey,
		value: V,
	): GlobalBuilder<TState & Record<TKey, V>> {
		const newState = { ...this.state, [key]: value } as any;
		return this._derive(newState);
	}

	/**
	 * Build the final global
	 */
	build(): Global<Prettify<TState>> {
		if (!this._builtGlobal) {
			// Resolve pending relations before building
			const resolvedState = this.resolvePendingRelations();
			this._builtGlobal = new Global(resolvedState);
		}
		return this._builtGlobal;
	}

	/**
	 * Lazy build getters
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

	get name() {
		return this.state.name;
	}

	get $infer() {
		return this.build().$infer;
	}
}

/**
 * Factory function to create a new global builder.
 *
 * @example Basic usage (uses QuestpieApp from module augmentation)
 * ```ts
 * const settings = global("settings").fields({ ... });
 * ```
 *
 * @example With typed app (recommended for full type safety)
 * ```ts
 * import type { App } from './app';
 *
 * const settings = global<App>()("settings")
 *   .fields({ ... })
 *   .hooks({
 *     afterUpdate: ({ app }) => {
 *       app.kv.set('cache', ...); // fully typed!
 *     }
 *   });
 * ```
 */
export function global<TName extends string>(
	name?: TName,
): GlobalBuilder<EmptyGlobalState<TName, undefined, BuiltinFields>> {
	// Overload 1: global("settings") - simple name
	return new GlobalBuilder({
		name: name as string,
		fields: {},
		localized: [],
		virtuals: {},
		relations: {},
		options: {},
		hooks: {},
		access: {},
		collaborative: undefined,
		fieldDefinitions: {},
	}) as any;
}
