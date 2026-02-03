/**
 * Proxy Types for Type-Safe Builder APIs
 *
 * These provide autocomplete and type safety in builder callbacks.
 */

import type { BlockDefinition } from "./block/types";
import type { FieldDefinition } from "./field/field";
import type { EditViewDefinition, ListViewDefinition } from "./view/view";

// ============================================================================
// Field Proxies
// ============================================================================

/**
 * Field Proxy - Maps field names to themselves for autocomplete
 *
 * Usage: ({ f }) => ({ columns: [f.name, f.email] })
 */
export type FieldProxy<TFields extends Record<string, any>> = {
	[K in keyof TFields]: K;
};

/**
 * Creates a field proxy at runtime
 */
export function createFieldProxy<TFields extends Record<string, any>>(
	fields?: TFields,
): FieldProxy<TFields> {
	if (!fields || Object.keys(fields).length === 0) {
		return new Proxy(
			{},
			{
				get: (_target, prop) => {
					if (typeof prop !== "string") return undefined;
					return prop;
				},
			},
		) as FieldProxy<TFields>;
	}

	const proxy = {} as any;
	for (const key in fields) {
		proxy[key] = key;
	}
	return proxy;
}

/**
 * Helper type to inject block names into BlocksFieldConfig.
 *
 * When a field config has `allowedBlocks`, this replaces string[] with
 * the actual block names from the registry for type-safe autocomplete.
 */
type InjectBlocksConfig<
	TConfig,
	TBlocks extends Record<string, BlockDefinition>,
> = TConfig extends { allowedBlocks?: string[] }
	? Omit<TConfig, "allowedBlocks"> & {
			allowedBlocks?: (keyof TBlocks & string)[];
		}
	: TConfig;

/**
 * Helper type to inject field registry into nested callbacks.
 *
 * When a config type has `fields` or `item` callbacks (like ObjectFieldConfig, ArrayFieldConfig),
 * this replaces the `any` or generic `r` parameter with the actual field registry type.
 * This enables type-safe autocomplete in nested field definitions.
 */
type InjectFieldRegistry<
	TConfig,
	TFields extends Record<string, FieldDefinition<any, any>>,
	TBlocks extends Record<string, BlockDefinition> = Record<
		string,
		BlockDefinition
	>,
> = TConfig extends {
	fields?: (ctx: { r: any }) => any;
}
	? Omit<TConfig, "fields"> & {
			fields?: (ctx: {
				r: FieldRegistryProxy<TFields, TBlocks>;
			}) => ReturnType<NonNullable<TConfig["fields"]>>;
		}
	: TConfig extends { item?: (ctx: { r: any }) => any }
		? Omit<TConfig, "item"> & {
				item?: (ctx: {
					r: FieldRegistryProxy<TFields, TBlocks>;
				}) => ReturnType<NonNullable<TConfig["item"]>>;
			}
		: TConfig;

/**
 * Apply all config injections (blocks, nested fields)
 */
type InjectAllConfig<
	TConfig,
	TFields extends Record<string, FieldDefinition<any, any>>,
	TBlocks extends Record<string, BlockDefinition>,
> = InjectBlocksConfig<InjectFieldRegistry<TConfig, TFields, TBlocks>, TBlocks>;

/**
 * Field Registry Proxy - Type-safe field builder methods
 *
 * Usage: ({ r }) => ({ name: r.text({ maxLength: 100 }) })
 *
 * For fields with nested callbacks (object, array), the registry type
 * is automatically injected so nested `r` has full autocomplete.
 *
 * For blocks fields, the `allowedBlocks` option is typed to only accept
 * block names from the registered blocks.
 *
 * @typeParam TFields - Field definitions from admin registry
 * @typeParam TBlocks - Block definitions from admin registry
 */
export type FieldRegistryProxy<
	TFields extends Record<string, FieldDefinition<any, any>>,
	TBlocks extends Record<string, BlockDefinition> = Record<
		string,
		BlockDefinition
	>,
> = {
	[K in keyof TFields]: TFields[K] extends FieldDefinition<
		infer TName,
		infer TFieldOptions
	>
		? (
				options?: InjectAllConfig<TFieldOptions, TFields, TBlocks>,
			) => FieldDefinition<
				TName,
				InjectAllConfig<TFieldOptions, TFields, TBlocks>
			>
		: never;
};

/**
 * Creates a field registry proxy at runtime
 */
export function createFieldRegistryProxy<
	TFields extends Record<string, FieldDefinition<any, any>>,
>(fields: TFields): FieldRegistryProxy<TFields> {
	const proxy = {} as any;
	for (const key in fields) {
		proxy[key] = (options?: any) => {
			const fieldDef = fields[key];
			// Important: Access getters explicitly to ensure they're evaluated
			// FieldBuilder uses getters for 'name', 'field', 'cell', '~options'
			return {
				name: fieldDef.name,
				"~options": { ...fieldDef["~options"], ...options },
				field: fieldDef.field,
				cell: fieldDef.cell,
			} as FieldDefinition;
		};
	}
	return proxy;
}

// ============================================================================
// View Proxies
// ============================================================================

/**
 * Helper type to make config optional when it's unknown or empty object
 */
type ViewConfigArg<TConfig> = unknown extends TConfig
	? TConfig | undefined
	: TConfig;

/**
 * View Registry Proxy - Type-safe view builder methods
 *
 * Usage: ({ v, f }) => v.table({ columns: [f.name] })
 *
 * The config parameter is typed based on what the view component expects.
 * If the component has `viewConfig?: TableViewConfig`, you get autocomplete
 * for `TableViewConfig` properties.
 *
 * @example
 * ```ts
 * .list(({ v, f }) => v.table({
 *   columns: [f.name, f.email],  // <- typed from TableViewConfig
 *   searchable: true,
 * }))
 * ```
 */
export type ViewRegistryProxy<TViews extends Record<string, any>> = {
	[K in keyof TViews]: TViews[K] extends ListViewDefinition<
		any,
		infer TListConfig
	>
		? (config?: ViewConfigArg<TListConfig>) => TViews[K]
		: TViews[K] extends EditViewDefinition<any, infer TEditConfig>
			? (config?: ViewConfigArg<TEditConfig>) => TViews[K]
			: never;
};

/**
 * Creates a view registry proxy at runtime
 */
export function createViewRegistryProxy<TViews extends Record<string, any>>(
	views: TViews,
): ViewRegistryProxy<TViews> {
	const proxy = {} as any;
	for (const key in views) {
		proxy[key] = (config?: any) => {
			const view = views[key];
			// Access state directly to avoid getter issues with class instances
			const existingConfig = view.state?.["~config"] ?? view["~config"] ?? {};
			return {
				name: view.name,
				kind: view.kind,
				component: view.component,
				state: view.state,
				"~config": { ...existingConfig, ...config },
			};
		};
	}
	return proxy;
}
