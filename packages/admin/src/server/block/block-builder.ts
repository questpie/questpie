/**
 * Block Builder
 *
 * Defines block types for the visual block editor.
 * Blocks are registered on the CMS builder and can be used in blocks fields.
 *
 * Each block has:
 * - Metadata (label, description, icon, category)
 * - Fields (using the same field system as collections)
 * - Optional prefetch function (runs on CRUD read to fetch related data)
 * - Optional children configuration (for nested blocks)
 *
 * @example
 * ```ts
 * import { block } from "@questpie/admin/server";
 *
 * const heroBlock = block("hero")
 *   .label({ en: "Hero Section" })
 *   .icon("ph:image")
 *   .category("layout")
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
import type { I18nText } from "questpie/shared";

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
	/** Display label */
	label?: I18nText;
	/** Description */
	description?: I18nText;
	/** Icon identifier (e.g., "ph:image") */
	icon?: string;
	/** Category for grouping in block picker */
	category?: string;
	/** Field definitions */
	fields?: TFields;
	/** Allow child blocks */
	allowChildren?: boolean;
	/** Maximum number of child blocks */
	maxChildren?: number;
	/** Prefetch function */
	prefetch?: BlockPrefetchFn;
	/** Order in block picker */
	order?: number;
	/** Hide from block picker */
	hidden?: boolean;
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
// Block Builder Class
// ============================================================================

/**
 * Builder class for defining block types.
 */
export class BlockBuilder<
	TState extends BlockBuilderState = BlockBuilderState,
> {
	private _state: TState;

	constructor(state: TState) {
		this._state = state;
	}

	/**
	 * Set display label for the block.
	 *
	 * @example
	 * ```ts
	 * block("hero").label({ en: "Hero Section", sk: "Hero sekcia" })
	 * ```
	 */
	label(label: I18nText): BlockBuilder<TState & { label: I18nText }> {
		return new BlockBuilder({
			...this._state,
			label,
		} as TState & { label: I18nText });
	}

	/**
	 * Set description for the block.
	 */
	description(
		description: I18nText,
	): BlockBuilder<TState & { description: I18nText }> {
		return new BlockBuilder({
			...this._state,
			description,
		} as TState & { description: I18nText });
	}

	/**
	 * Set icon for the block (Iconify format).
	 *
	 * @example
	 * ```ts
	 * block("hero").icon("ph:image")
	 * ```
	 */
	icon(icon: string): BlockBuilder<TState & { icon: string }> {
		return new BlockBuilder({
			...this._state,
			icon,
		} as TState & { icon: string });
	}

	/**
	 * Set category for grouping in block picker.
	 *
	 * @example
	 * ```ts
	 * block("hero").category("layout")
	 * block("text").category("content")
	 * ```
	 */
	category(category: string): BlockBuilder<TState & { category: string }> {
		return new BlockBuilder({
			...this._state,
			category,
		} as TState & { category: string });
	}

	/**
	 * Set order in block picker.
	 */
	order(order: number): BlockBuilder<TState & { order: number }> {
		return new BlockBuilder({
			...this._state,
			order,
		} as TState & { order: number });
	}

	/**
	 * Hide block from block picker.
	 * Useful for deprecated blocks that should still render but not be addable.
	 */
	hidden(hidden = true): BlockBuilder<TState & { hidden: boolean }> {
		return new BlockBuilder({
			...this._state,
			hidden,
		} as TState & { hidden: boolean });
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
		factory: (f: FieldBuilderProxy<Record<string, any>>) => TNewFields,
	): BlockBuilder<Omit<TState, "fields"> & { fields: TNewFields }> {
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
	): BlockBuilder<TState & { allowChildren: true; maxChildren?: number }> {
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
	): BlockBuilder<TState & { prefetch: BlockPrefetchFn<TValues> }> {
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
 * Create a new block builder.
 *
 * @example
 * ```ts
 * import { block } from "@questpie/admin/server";
 *
 * const heroBlock = block("hero")
 *   .label({ en: "Hero Section" })
 *   .icon("ph:image")
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
export type AnyBlockBuilder = BlockBuilder<BlockBuilderState>;

/**
 * Any block definition (for generic usage).
 */
export type AnyBlockDefinition = BlockDefinition<BlockBuilderState>;
