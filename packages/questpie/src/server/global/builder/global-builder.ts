import type { SQL } from "drizzle-orm";

import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import {
	createFieldsCallbackContext,
	type FieldsCallbackContext,
} from "#questpie/server/fields/builder.js";
import {
	type BuiltinFields,
	builtinFields,
} from "#questpie/server/fields/builtin/defaults.js";
import type { RelationFieldMetadata } from "#questpie/server/fields/types.js";
import { Global } from "#questpie/server/global/builder/global.js";
import type {
	EmptyGlobalState,
	GlobalAccess,
	GlobalBuilderState,
	GlobalHooks,
	GlobalOptions,
} from "#questpie/server/global/builder/types.js";
import type { Override, Prettify } from "#questpie/shared/type-utils.js";

/**
 * Extract Drizzle column types from field definitions.
 */
type ExtractColumnsFromFieldDefinitions<TFields extends Record<string, any>> = {
	[K in keyof TFields]: TFields[K]["$types"]["column"] extends null
		? never
		: TFields[K]["$types"]["column"];
};

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
	private state: TState;
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
				fields: ExtractColumnsFromFieldDefinitions<TNewFields>;
				localized: [];
				fieldDefinitions: TNewFields;
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
				fields: TNewFields;
				localized: [];
				fieldDefinitions: undefined;
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

			virtuals = {
				...(this.state.virtuals || {}),
				...virtuals,
			};
		} else {
			// Raw Drizzle columns
			columns = fieldsOrFactory;
			virtuals = this.state.virtuals || {};
			fieldDefinitions = undefined;
		}

		const newState = {
			...this.state,
			fields: columns,
			localized: localizedFields,
			virtuals,
			fieldDefinitions,
			_pendingRelations: pendingRelations,
		} as any;

		const newBuilder = new GlobalBuilder(newState);
		return newBuilder;
	}

	/**
	 * Set global options
	 */
	options<TNewOptions extends GlobalOptions>(
		options: TNewOptions,
	): GlobalBuilder<Override<TState, { options: TNewOptions }>> {
		const newState = {
			...this.state,
			options,
		} as any;

		const newBuilder = new GlobalBuilder(newState);
		return newBuilder;
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

		const newBuilder = new GlobalBuilder(newState);
		return newBuilder;
	}

	/**
	 * Set access control rules
	 */
	access<TNewAccess extends GlobalAccess<any>>(
		access: TNewAccess,
	): GlobalBuilder<Override<TState, { access: Record<string, any> }>> {
		const newState = {
			...this.state,
			access,
		} as any;

		const newBuilder = new GlobalBuilder(newState);
		return newBuilder;
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
		return new GlobalBuilder(newState);
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
		fieldDefinitions: {},
	}) as any;
}
