import type { SQL } from "drizzle-orm";
import type { RelationConfig } from "#questpie/server/collection/builder/types.js";
import {
	createFieldBuilder,
	type FieldBuilderProxy,
} from "#questpie/server/fields/builder.js";
import {
	type BuiltinFields,
	builtinFields,
} from "#questpie/server/fields/builtin/defaults.js";
import type {
	FieldDefinition,
	FieldDefinitionState,
	RelationFieldMetadata,
} from "#questpie/server/fields/types.js";
import type { FunctionDefinition } from "#questpie/server/functions/types.js";
import type { GlobalBuilderExtensions } from "#questpie/server/global/builder/extensions.js";
import { Global } from "#questpie/server/global/builder/global.js";
import type {
	EmptyGlobalState,
	GlobalAccess,
	GlobalBuilderState,
	GlobalHooks,
	GlobalOptions,
} from "#questpie/server/global/builder/types.js";
import type {
	Prettify,
	SetProperty,
	TypeMerge,
	UnsetProperty,
} from "#questpie/shared/type-utils.js";

/**
 * Extract Drizzle column types from field definitions.
 */
type ExtractColumnsFromFieldDefinitions<
	TFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
> = {
	[K in keyof TFields]: TFields[K]["$types"]["column"] extends null
		? never
		: TFields[K]["$types"]["column"];
};

/**
 * Extract field types from GlobalBuilderState.
 * Falls back to DefaultFieldTypeMap if not available.
 *
 * Uses ~fieldTypes phantom property which is set by EmptyGlobalState
 * based on the QuestpieBuilder's state.fields.
 */
type ExtractFieldTypes<TState extends GlobalBuilderState> =
	TState["~fieldTypes"] extends infer TFields
		? TFields extends Record<string, any>
			? TFields
			: {} // No fields registered — f will be empty
		: {};

type InferAppFromBuilder<TBuilder> = TBuilder extends {
	build: (...args: any[]) => infer TApp;
}
	? TApp
	: any;

type GlobalAppOf<TState extends GlobalBuilderState> = InferAppFromBuilder<
	TState["~questpieApp"]
>;

/**
 * Main global builder class
 */
// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: Declaration merging is intentional for extension pattern
export class GlobalBuilder<TState extends GlobalBuilderState> {
	private state: TState;
	private _builtGlobal?: Global<TState>;

	constructor(state: TState) {
		this.state = state;
	}

	/**
	 * Define fields using Field Builder (recommended)
	 *
	 * When using `q.global()`, field types are inferred from `q.fields()`.
	 * When using standalone `global()`, falls back to DefaultFieldTypeMap.
	 *
	 * @example
	 * ```ts
	 * // With q.global() - field types from q.fields(defaultFields)
	 * q.global("settings").fields((f) => ({
	 *   siteName: f.text({ required: true }),  // ✅ autocomplete
	 * }))
	 *
	 * // Standalone - uses default registry
	 * global("settings").fields((f) => ({
	 *   siteName: f.text({ required: true }),
	 * }))
	 * ```
	 */
	fields<
		const TNewFields extends Record<
			string,
			FieldDefinition<FieldDefinitionState>
		>,
	>(
		factory: (f: FieldBuilderProxy<ExtractFieldTypes<TState>>) => TNewFields,
	): GlobalBuilder<
		TypeMerge<
			UnsetProperty<TState, "fields" | "localized" | "fieldDefinitions">,
			{
				fields: ExtractColumnsFromFieldDefinitions<TNewFields>;
				localized: [];
				fieldDefinitions: TNewFields;
			}
		>
	>;

	/**
	 * Define fields using Drizzle column definitions (backward compatible)
	 */
	fields<TNewFields extends Record<string, any>>(
		// Exclude functions from this overload
		fields: TNewFields extends (...args: any[]) => any ? never : TNewFields,
	): GlobalBuilder<
		TypeMerge<
			UnsetProperty<TState, "fields" | "localized" | "fieldDefinitions">,
			{
				fields: TNewFields;
				localized: [];
				fieldDefinitions: undefined;
			}
		>
	>;

	// Implementation
	fields<TNewFields extends Record<string, any>>(
		fieldsOrFactory: TNewFields | ((f: FieldBuilderProxy<any>) => TNewFields),
	): GlobalBuilder<any> {
		let columns: Record<string, any>;
		let virtuals: Record<string, SQL> = {};
		let fieldDefinitions:
			| Record<string, FieldDefinition<FieldDefinitionState>>
			| undefined;
		const pendingRelations: Array<{
			name: string;
			metadata: RelationFieldMetadata;
		}> = [];
		const localizedFields: string[] = [];

		if (typeof fieldsOrFactory === "function") {
			// Field Builder pattern - use field defs from ~questpieApp, or fall back to builtinFields
			const questpieFields =
				(this.state as any)["~questpieApp"]?.state?.fields ?? builtinFields;
			const builderProxy = createFieldBuilder(questpieFields);

			const fieldDefs = fieldsOrFactory(builderProxy);
			fieldDefinitions = fieldDefs;

			// Extract Drizzle columns from field definitions
			columns = {};
			for (const [name, fieldDef] of Object.entries(fieldDefs)) {
				// Check if field is localized (location === "i18n")
				if (fieldDef.state?.location === "i18n") {
					localizedFields.push(name);
				}

				if (fieldDef.state?.location === "virtual") {
					const virtualValue = (fieldDef.state.config as { virtual?: unknown })
						?.virtual;
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
			// Raw Drizzle columns (backward compatible)
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
	): GlobalBuilder<SetProperty<TState, "options", TNewOptions>> {
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
	): GlobalBuilder<SetProperty<TState, "hooks", TNewHooks>> {
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
	): GlobalBuilder<SetProperty<TState, "access", TNewAccess>> {
		const newState = {
			...this.state,
			access,
		} as any;

		const newBuilder = new GlobalBuilder(newState);
		return newBuilder;
	}

	/**
	 * Define RPC functions for this global
	 */
	functions<TNewFunctions extends Record<string, FunctionDefinition>>(
		functions: TNewFunctions,
	): GlobalBuilder<
		SetProperty<
			TState,
			"functions",
			TypeMerge<
				UnsetProperty<TState["functions"], keyof TNewFunctions>,
				TNewFunctions
			>
		>
	> {
		const newState = {
			...this.state,
			functions: {
				...this.state.functions,
				...functions,
			},
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

// =============================================================================
// Declaration Merging for Extensions
// =============================================================================

/**
 * Declaration merging: GlobalBuilder implements GlobalBuilderExtensions.
 *
 * This allows packages to augment GlobalBuilderExtensions and have those
 * methods appear on GlobalBuilder instances.
 */
export interface GlobalBuilder<TState extends GlobalBuilderState>
	extends GlobalBuilderExtensions {}

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
 * import type { AppCMS } from './cms';
 *
 * const settings = global<AppCMS>()("settings")
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
		functions: {},
		fieldDefinitions: {},
		"~questpieApp": undefined,
	}) as any;
}
