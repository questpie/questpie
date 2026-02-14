/**
 * Block Builder
 *
 * Defines block types for the visual block editor.
 * Blocks are registered on the CMS builder and can be used in blocks fields.
 *
 * Each block has:
 * - Admin metadata (label, description, icon, category) via .admin()
 * - Fields (using the same field system as collections)
 * - Optional prefetch function (runs on CRUD read to fetch related data)
 * - Optional children configuration (for nested blocks)
 *
 * @example
 * ```ts
 * import { block } from "@questpie/admin/server";
 *
 * const heroBlock = block("hero")
 *   .admin(({ c }) => ({
 *     label: { en: "Hero Section", sk: "Hero sekcia" },
 *     icon: c.icon("ph:image"),
 *     category: {
 *       label: { en: "Sections", sk: "Sekcie" },
 *       icon: c.icon("ph:layout"),
 *     },
 *   }))
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     subtitle: f.text(),
 *     backgroundImage: f.upload({ accept: "image/*" }),
 *   }))
 *   .prefetch({ with: { backgroundImage: true } });
 * ```
 */

import type {
	FieldBuilderProxy,
	FieldDefinition,
	FieldDefinitionState,
	RegisteredApp,
} from "questpie";
import type { AdminBlockConfig, AdminConfigContext } from "../augmentation.js";

// ============================================================================
// Block Types
// ============================================================================

/**
 * Block prefetch context.
 * Provided to prefetch functions to fetch related data.
 *
 * When you register your app via `Register.app`, `ctx.app` is automatically typed.
 * For module-scoped typing, use `getApp<T>(ctx.app)`.
 *
 * @example
 * ```ts
 * // questpie.gen.ts - register your app for automatic typing
 * declare module "questpie" {
 *   interface Register {
 *     app: typeof import("./cms").baseCms.$inferCms;
 *   }
 * }
 *
 * // blocks.ts - ctx.app is now typed
 * .prefetch(async ({ values, ctx }) => {
 *   const res = await ctx.app.api.collections.posts.find({ limit: 5 });
 *   return { posts: res.docs };
 * })
 * ```
 */
export interface BlockPrefetchContext {
	/** Block instance ID */
	blockId: string;
	/** Block type name */
	blockType: string;
	/** CMS app instance — typed via Register.app */
	app: RegisteredApp;
	/** Current locale */
	locale?: string;
	/** Database client */
	db: unknown;
}

/**
 * Block prefetch function.
 * Runs during CRUD read to fetch related data for the block.
 * The returned data is attached to `_data[blockId]` in the response.
 */
export type BlockPrefetchFn<TValues = Record<string, unknown>> = (params: {
	/** Block field values */
	values: TValues;
	/** Prefetch context */
	ctx: BlockPrefetchContext;
}) => Promise<Record<string, unknown>> | Record<string, unknown>;

/**
 * Expanded record from expansion of relation/upload fields.
 * Contains at minimum an `id` field plus any other fields from the referenced record.
 */
export type ExpandedRecord = Record<string, unknown> & { id: string };

/**
 * Options for a single relation inside a block prefetch `with` clause.
 * Same syntax as find's `with`, but only nested `with` is supported —
 * query options (where, orderBy, limit, etc.) don't apply to block field expansion.
 *
 * Nested `with` is passed through to the collection's `find` call,
 * reusing the existing relation resolution machinery.
 */
export type BlockPrefetchWithOptions = {
	with?: Record<string, true | BlockPrefetchWithOptions>;
};

/**
 * Block prefetch `with` clause.
 * Same object syntax as `with` in find operations.
 *
 * Each key is a relation/upload field name. Value can be:
 * - `true` — expand the field to a full record
 * - `{ with: { ... } }` — expand with nested relation loading
 *
 * @example
 * ```ts
 * // Simple expansion
 * .prefetch({ with: { backgroundImage: true } })
 *
 * // Nested expansion (e.g., expand author and their avatar)
 * .prefetch({ with: { author: { with: { avatar: true } } } })
 * ```
 */
export type BlockPrefetchWith<TFields = Record<string, unknown>> = {
	[K in keyof TFields]?: true | BlockPrefetchWithOptions;
};

/**
 * Compute the expanded data type from a `with` config object.
 * Each key that is `true` or `{ with: ... }` produces `ExpandedRecord | null`.
 */
export type ExpandWithResult<TWith> = {
	[K in keyof TWith as TWith[K] extends false | undefined
		? never
		: K]: ExpandedRecord | null;
};

/**
 * Block builder state.
 */
export interface BlockBuilderState<
	TName extends string = string,
	TFields extends Record<
		string,
		FieldDefinition<FieldDefinitionState>
	> = Record<string, FieldDefinition<FieldDefinitionState>>,
> {
	/** Block type name */
	name: TName;
	/** Admin configuration (label, icon, description, category, etc.) */
	admin?: AdminBlockConfig;
	/** Field definitions */
	fields?: TFields;
	/** Allow child blocks */
	allowChildren?: boolean;
	/** Maximum number of child blocks */
	maxChildren?: number;
	/** Prefetch function (Shape 1: pure function) */
	prefetch?: BlockPrefetchFn<any>;
	/** Relation fields to expand via `.prefetch({ with: { ... } })` */
	prefetchWith?: BlockPrefetchWith;
	/** Loader function for `.prefetch({ with, loader })` (Shape 3) */
	_prefetchLoader?: (params: {
		values: any;
		expanded: Record<string, unknown>;
		ctx: BlockPrefetchContext;
	}) => Promise<Record<string, unknown>> | Record<string, unknown>;
	/** Type-level marker for prefetch data type (not used at runtime) */
	"~prefetchData"?: unknown;
	/** Optional registered component names from Questpie builder registry */
	"~components"?: string[];
}

/**
 * Block definition - the built block ready for registration.
 */
export interface BlockDefinition<
	TState extends BlockBuilderState = BlockBuilderState,
> {
	/** Block type name */
	readonly name: TState["name"];
	/** Full state */
	readonly state: TState;
	/** Get field metadata for introspection */
	getFieldMetadata(): Record<string, unknown>;
	/** Execute prefetch if defined */
	executePrefetch(
		values: Record<string, unknown>,
		ctx: BlockPrefetchContext,
	): Promise<Record<string, unknown>>;
}

// ============================================================================
// Component Proxy Factory (same pattern as collections)
// ============================================================================

/**
 * Create a component proxy for type-safe icon and UI element references.
 * Used in .admin() config functions.
 */
function createComponentProxy(
	registeredComponentNames: string[] = [],
): AdminConfigContext["c"] {
	const registered = new Set(registeredComponentNames);
	const hasRegistry = registered.size > 0;

	return new Proxy(
		{} as Record<string, (props: Record<string, unknown> | string) => unknown>,
		{
			get: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return undefined;
				}

				if (prop === "then") {
					return undefined;
				}

				if (hasRegistry && !registered.has(prop)) {
					throw new Error(
						`Unknown component "${prop}" for block admin config. ` +
							`Available components: ${[...registered].sort().join(", ")}`,
					);
				}

				return (props: Record<string, unknown> | string) => {
					if (prop === "icon" && typeof props === "string") {
						return { type: "icon", props: { name: props } } as const;
					}

					if (typeof props === "object" && props !== null) {
						return { type: prop, props } as const;
					}

					return { type: prop, props: { value: props } } as const;
				};
			},
			has: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return false;
				}
				return hasRegistry ? registered.has(prop) : true;
			},
			ownKeys: () => (hasRegistry ? [...registered] : []),
			getOwnPropertyDescriptor: (_target, prop: string | symbol) => {
				if (typeof prop !== "string") {
					return undefined;
				}

				if (hasRegistry && !registered.has(prop)) {
					return undefined;
				}

				return {
					configurable: true,
					enumerable: hasRegistry,
					writable: false,
					value: (props: Record<string, unknown> | string) => {
						if (prop === "icon" && typeof props === "string") {
							return { type: "icon", props: { name: props } } as const;
						}

						if (typeof props === "object" && props !== null) {
							return { type: prop, props } as const;
						}

						return { type: prop, props: { value: props } } as const;
					},
				};
			},
		},
	) as AdminConfigContext["c"];
}

// ============================================================================
// Block Builder Class
// ============================================================================

/**
 * Builder class for defining block types.
 *
 * @template TState - Block builder state
 * @template TFieldMap - Field type map for typed field proxy (from builder's registered fields)
 * @template TData - Prefetch data type (set by .prefetch(), preserved through chain)
 */
export class BlockBuilder<
	TState extends BlockBuilderState = BlockBuilderState,
	TFieldMap extends Record<string, any> = Record<string, any>,
	TData = Record<string, unknown>,
> {
	private _state: TState;

	constructor(state: TState) {
		this._state = state;
	}

	/**
	 * Set admin metadata for the block.
	 * Follows the same pattern as collection .admin() method.
	 *
	 * @example
	 * ```ts
	 * block("hero")
	 *   .admin(({ c }) => ({
	 *     label: { en: "Hero Section", sk: "Hero sekcia" },
	 *     icon: c.icon("ph:image"),
	 *     description: { en: "Full-width hero with background image" },
	 *     category: {
	 *       label: { en: "Sections", sk: "Sekcie" },
	 *       icon: c.icon("ph:layout"),
	 *       order: 1,
	 *     },
	 *     order: 1,
	 *     hidden: false,
	 *   }))
	 * ```
	 */
	admin(
		configOrFn:
			| AdminBlockConfig
			| ((ctx: AdminConfigContext) => AdminBlockConfig),
	): BlockBuilder<TState & { admin: AdminBlockConfig }, TFieldMap, TData> {
		const registeredComponents =
			(this._state as any)["~components"] ?? ([] as string[]);

		const config =
			typeof configOrFn === "function"
				? configOrFn({ c: createComponentProxy(registeredComponents) })
				: configOrFn;

		return new BlockBuilder<
			TState & { admin: AdminBlockConfig },
			TFieldMap,
			TData
		>({
			...this._state,
			admin: config,
		} as TState & { admin: AdminBlockConfig });
	}

	/**
	 * Define fields for the block.
	 * Uses the same field builder as collections.
	 *
	 * @example
	 * ```ts
	 * block("hero").fields((f) => ({
	 *   title: f.text({ required: true }),
	 *   subtitle: f.text(),
	 *   image: f.upload({ accept: "image/*" }),
	 * }))
	 * ```
	 */
	fields<
		TNewFields extends Record<string, FieldDefinition<FieldDefinitionState>>,
	>(
		factory: (f: FieldBuilderProxy<TFieldMap>) => TNewFields,
	): BlockBuilder<
		Omit<TState, "fields"> & { fields: TNewFields },
		TFieldMap,
		TData
	> {
		// Store the factory for later resolution when CMS is built
		// The actual field definitions are created when block is registered
		return new BlockBuilder({
			...this._state,
			_fieldsFactory: factory,
		} as any);
	}

	/**
	 * Allow child blocks (for layout blocks).
	 *
	 * @example
	 * ```ts
	 * block("columns").allowChildren()
	 * block("columns").allowChildren(4) // max 4 children
	 * ```
	 */
	allowChildren(
		maxChildren?: number,
	): BlockBuilder<
		TState & { allowChildren: true; maxChildren?: number },
		TFieldMap,
		TData
	> {
		return new BlockBuilder({
			...this._state,
			allowChildren: true,
			maxChildren,
		} as TState & { allowChildren: true; maxChildren?: number });
	}

	/**
	 * Add prefetch configuration for server-side data fetching.
	 * Runs during CRUD read to fetch related data for the block.
	 *
	 * Supports three shapes:
	 *
	 * **Shape 1: Pure function** — return data directly, `TData` inferred from return type.
	 * ```ts
	 * .prefetch(async ({ values, ctx }) => {
	 *   return { services: res.docs };
	 * })
	 * ```
	 *
	 * **Shape 2: Expand relation/upload fields** — same `with` syntax as find operations.
	 * ```ts
	 * .prefetch({ with: { backgroundImage: true } })
	 *
	 * // Nested expansion (passes through to collection find's `with`)
	 * .prefetch({ with: { author: { with: { avatar: true } } } })
	 * ```
	 *
	 * **Shape 3: Expand + custom loader** — expand fields, then run a loader with the expanded data.
	 * ```ts
	 * .prefetch({
	 *   with: { backgroundImage: true },
	 *   loader: async ({ values, expanded, ctx }) => {
	 *     return { analytics: await getStats() };
	 *   },
	 * })
	 * ```
	 */
	// Overload 1: Pure function (Shape 1)
	prefetch<TNewData extends Record<string, unknown>>(
		fn: (params: {
			values: InferBlockValues<TState>;
			ctx: BlockPrefetchContext;
		}) => Promise<TNewData> | TNewData,
	): BlockBuilder<
		Omit<TState, "prefetch" | "~prefetchData"> & {
			prefetch: typeof fn;
			"~prefetchData": TNewData;
		},
		TFieldMap,
		TNewData
	>;
	// Overload 2: Config object with `with` and optional `loader` (Shape 2 & 3)
	prefetch<
		const TWith extends BlockPrefetchWith<InferBlockValues<TState>>,
		TLoaderData extends Record<string, unknown> = {},
	>(config: {
		with: TWith;
		loader?: (params: {
			values: InferBlockValues<TState>;
			expanded: ExpandWithResult<TWith>;
			ctx: BlockPrefetchContext;
		}) => Promise<TLoaderData> | TLoaderData;
	}): BlockBuilder<
		Omit<
			TState,
			"prefetch" | "prefetchWith" | "_prefetchLoader" | "~prefetchData"
		> & {
			prefetchWith: TWith;
			"~prefetchData": ExpandWithResult<TWith> & TLoaderData;
		},
		TFieldMap,
		ExpandWithResult<TWith> & TLoaderData
	>;
	// Implementation
	prefetch(fnOrConfig: any): any {
		if (typeof fnOrConfig === "function") {
			return new BlockBuilder({
				...this._state,
				prefetch: fnOrConfig,
			} as any);
		}

		const { with: withFields, loader } = fnOrConfig;
		return new BlockBuilder({
			...this._state,
			prefetchWith: withFields,
			_prefetchLoader: loader,
		} as any);
	}

	/**
	 * Build the block definition.
	 * Called automatically when registering with .blocks().
	 */
	build(): BlockDefinition<TState> {
		const state = this._state;

		return {
			name: state.name,
			state,
			getFieldMetadata() {
				if (!state.fields) return {};
				const metadata: Record<string, unknown> = {};
				for (const [name, fieldDef] of Object.entries(state.fields)) {
					metadata[name] = fieldDef.getMetadata();
				}
				return metadata;
			},
			async executePrefetch(values, ctx) {
				if (!state.prefetch) return {};
				return state.prefetch({ values, ctx });
			},
		};
	}

	/**
	 * Get the current state (for internal use).
	 */
	get state(): TState {
		return this._state;
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new server-side block builder.
 *
 * Defines block types with fields, validation, and prefetch logic.
 * Blocks are server-only - the frontend handles rendering independently.
 *
 * @example
 * ```ts
 * import { block } from "@questpie/admin/server";
 *
 * const heroBlock = block("hero")
 *   .admin(({ c }) => ({
 *     label: { en: "Hero Section" },
 *     icon: c.icon("ph:image"),
 *     category: {
 *       label: { en: "Layout" },
 *     },
 *   }))
 *   .fields((f) => ({
 *     title: f.text({ required: true }),
 *     subtitle: f.text(),
 *   }));
 *
 * // Register blocks on CMS
 * const cms = q({ name: "my-app" })
 *   .use(adminModule)
 *   .blocks({ hero: heroBlock })
 *   .build({ ... });
 * ```
 */
export function block<TName extends string>(
	name: TName,
): BlockBuilder<{ name: TName }> {
	return new BlockBuilder({ name });
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Extract field values type from block state.
 * Infers value type per-field to produce heterogeneous types
 * (e.g., { title: string, count: number, showPrices: boolean }).
 */
export type InferBlockValues<TState extends BlockBuilderState> =
	TState["fields"] extends Record<string, FieldDefinition<FieldDefinitionState>>
		? {
				[K in keyof TState["fields"]]: TState["fields"][K] extends FieldDefinition<
					infer TFieldState
				>
					? TFieldState["value"]
					: unknown;
			}
		: Record<string, unknown>;

/**
 * Extract prefetch data type from a block builder or block state.
 * Infers the `data` type based on `.prefetch()` configuration:
 * - Shape 1 (function): return type of the prefetch function
 * - Shape 2 (`{ with }` ): expanded fields as `{ [field]: ExpandedRecord | null }`
 * - Shape 3 (`{ with, loader }`): expanded fields merged with loader return type
 * - No prefetch: `Record<string, unknown>`
 *
 * Accepts either a `BlockBuilder` instance or a `BlockBuilderState`.
 * Prefer passing the builder — state-level extraction may fail when
 * `as any` casts are present in the builder chain.
 */
export type InferBlockData<T> =
	T extends BlockBuilder<any, any, infer TData>
		? TData
		: T extends BlockBuilderState
			? T["~prefetchData"] extends Record<string, unknown>
				? T["~prefetchData"]
				: Record<string, unknown>
			: Record<string, unknown>;

/**
 * Any block builder (for generic usage).
 */
export type AnyBlockBuilder = BlockBuilder<BlockBuilderState, any, any>;

/**
 * Any block definition (for generic usage).
 */
export type AnyBlockDefinition = BlockDefinition<BlockBuilderState>;
