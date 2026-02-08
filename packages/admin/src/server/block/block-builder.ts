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
 *   .prefetch(async ({ values, ctx }) => {
 *     // Fetch related data
 *     return { analytics: await getHeroAnalytics(values.id) };
 *   });
 * ```
 */

import type {
	FieldBuilderProxy,
	FieldDefinition,
	FieldDefinitionState,
} from "questpie";
import type { AdminBlockConfig, AdminConfigContext } from "../augmentation.js";

// ============================================================================
// Block Types
// ============================================================================

/**
 * Block prefetch context.
 * Provided to prefetch functions to fetch related data.
 */
export interface BlockPrefetchContext {
	/** Block instance ID */
	blockId: string;
	/** Block type name */
	blockType: string;
	/** CMS app instance */
	app: unknown;
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
	/** Prefetch function */
	prefetch?: BlockPrefetchFn;
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
function createComponentProxy(): AdminConfigContext["c"] {
	return {
		icon: (name: string) => ({ type: "icon", props: { name } }) as const,
		badge: (props: { text: string; color?: string }) =>
			({ type: "badge", props }) as const,
	};
}

// ============================================================================
// Block Builder Class
// ============================================================================

/**
 * Builder class for defining block types.
 *
 * @template TState - Block builder state
 * @template TFieldMap - Field type map for typed field proxy (from builder's registered fields)
 */
export class BlockBuilder<
	TState extends BlockBuilderState = BlockBuilderState,
	TFieldMap extends Record<string, any> = Record<string, any>,
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
	): BlockBuilder<TState & { admin: AdminBlockConfig }, TFieldMap> {
		const config =
			typeof configOrFn === "function"
				? configOrFn({ c: createComponentProxy() })
				: configOrFn;

		return new BlockBuilder({
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
	): BlockBuilder<Omit<TState, "fields"> & { fields: TNewFields }, TFieldMap> {
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
		TFieldMap
	> {
		return new BlockBuilder({
			...this._state,
			allowChildren: true,
			maxChildren,
		} as TState & { allowChildren: true; maxChildren?: number });
	}

	/**
	 * Add prefetch function.
	 * Runs during CRUD read to fetch related data for the block.
	 *
	 * @example
	 * ```ts
	 * block("featuredPosts")
	 *   .fields((f) => ({
	 *     count: f.number({ default: 3 }),
	 *     category: f.relation({ to: () => categories }),
	 *   }))
	 *   .prefetch(async ({ values, ctx }) => {
	 *     const posts = await ctx.app.api.collections.posts.find({
	 *       limit: values.count ?? 3,
	 *     });
	 *     return { posts: posts.docs };
	 *   })
	 * ```
	 */
	prefetch<TValues = Record<string, unknown>>(
		fn: BlockPrefetchFn<TValues>,
	): BlockBuilder<TState & { prefetch: BlockPrefetchFn<TValues> }, TFieldMap> {
		return new BlockBuilder({
			...this._state,
			prefetch: fn,
		} as TState & { prefetch: BlockPrefetchFn<TValues> });
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
 */
export type InferBlockValues<TState extends BlockBuilderState> =
	TState["fields"] extends Record<string, FieldDefinition<infer TFieldState>>
		? TFieldState extends FieldDefinitionState
			? { [K in keyof TState["fields"]]: TFieldState["value"] }
			: Record<string, unknown>
		: Record<string, unknown>;

/**
 * Any block builder (for generic usage).
 */
export type AnyBlockBuilder = BlockBuilder<BlockBuilderState, any>;

/**
 * Any block definition (for generic usage).
 */
export type AnyBlockDefinition = BlockDefinition<BlockBuilderState>;
