/**
 * Block Renderer Registry
 *
 * Type-safe registry for client-side block renderers that infers
 * value types from server-defined block schemas.
 *
 * Key design principles:
 * 1. Server defines WHAT (block schema, prefetch) - see @questpie/admin/server
 * 2. Client defines HOW (React components for rendering)
 * 3. Types are inferred from server app type - no duplication
 *
 * @example
 * ```ts
 * import { createBlockRegistry } from "@questpie/admin/client";
 * import type { App } from "@/server/app";
 *
 * export const blockRenderers = createBlockRegistry<App>()
 *   .register("hero", {
 *     // Props are inferred from server block schema!
 *     // values: { title: string, subtitle?: string, alignment: "left" | "center" | "right", ... }
 *     // data: Awaited<ReturnType<typeof heroBlock.prefetch>>
 *     component: ({ values, data }) => (
 *       <section className={`hero hero--${values.alignment}`}>
 *         <h1>{values.title}</h1>
 *       </section>
 *     ),
 *   })
 *   .register("featuredPosts", {
 *     component: ({ values, data }) => (
 *       <div className="featured-posts">
 *         {data?.posts?.map(post => <PostCard key={post.id} post={post} />)}
 *       </div>
 *     ),
 *   });
 * ```
 */

import type * as React from "react";

// ============================================================================
// Server Block Type Extraction
// ============================================================================

/**
 * Extract blocks from app type.
 * Handles the state.blocks structure from QuestpieBuilder.
 */
export type ExtractServerBlocks<TApp> = TApp extends {
	state: { blocks: infer B };
}
	? B extends Record<string, any>
		? B
		: Record<string, never>
	: Record<string, never>;

/**
 * Get block names from app type.
 */
export type ServerBlockNames<TApp> = keyof ExtractServerBlocks<TApp>;

/**
 * Extract field values type from a server block definition.
 * Looks at the block's state.fields and extracts value types.
 */
export type ExtractBlockFieldValues<TBlock> = TBlock extends {
	state: { fields: infer TFields };
}
	? TFields extends Record<string, { $types: { value: infer V } }>
		? { [K in keyof TFields]: TFields[K]["$types"]["value"] }
		: Record<string, unknown>
	: Record<string, unknown>;

/**
 * Extract prefetch data type from a server block definition.
 * Looks at the block's state.prefetch return type.
 */
export type ExtractBlockPrefetchData<TBlock> = TBlock extends {
	state: { prefetch: (params: any) => Promise<infer R> };
}
	? R
	: TBlock extends { state: { prefetch: (params: any) => infer R } }
		? R
		: undefined;

/**
 * Block values type for a specific block name in an app.
 */
export type BlockValues<
	TApp,
	TBlockName extends keyof ExtractServerBlocks<TApp>,
> = ExtractBlockFieldValues<ExtractServerBlocks<TApp>[TBlockName]>;

/**
 * Block prefetch data type for a specific block name in an app.
 */
export type BlockPrefetchData<
	TApp,
	TBlockName extends keyof ExtractServerBlocks<TApp>,
> = ExtractBlockPrefetchData<ExtractServerBlocks<TApp>[TBlockName]>;

// ============================================================================
// Block Renderer Types
// ============================================================================

/**
 * Props passed to block renderer components.
 */
export interface BlockRendererProps<
	TValues = Record<string, unknown>,
	TData = unknown,
> {
	/** Block instance ID */
	id: string;
	/** Block field values */
	values: TValues;
	/** Data from server-side prefetch (if block has prefetch defined) */
	data: TData;
	/** Rendered child blocks (for layout blocks) */
	children?: React.ReactNode;
	/** Whether this block is currently selected in the editor */
	isSelected?: boolean;
	/** Whether rendering in preview mode */
	isPreview?: boolean;
}

/**
 * Block renderer component type.
 */
export type BlockRendererComponent<
	TValues = Record<string, unknown>,
	TData = unknown,
> = React.ComponentType<BlockRendererProps<TValues, TData>>;

/**
 * Block renderer definition.
 */
export interface BlockRendererDefinition<
	TValues = Record<string, unknown>,
	TData = unknown,
> {
	/** React component for rendering the block */
	component: BlockRendererComponent<TValues, TData>;
}

// ============================================================================
// Block Registry
// ============================================================================

/**
 * Type-safe block renderer registry.
 * Tracks which blocks have been registered for type checking.
 */
export interface BlockRegistry<
	TApp,
	TRegistered extends Record<
		string,
		BlockRendererDefinition<any, any>
	> = Record<string, never>,
> {
	/**
	 * Register a renderer for a block type.
	 *
	 * @param blockName - Name of the block (must match server block definition)
	 * @param definition - Block renderer definition with component
	 * @returns Updated registry with the new block registered
	 *
	 * @example
	 * ```ts
	 * registry.register("hero", {
	 *   component: ({ values, data }) => <HeroSection {...values} data={data} />
	 * })
	 * ```
	 */
	register<TBlockName extends ServerBlockNames<TApp> & string>(
		blockName: TBlockName,
		definition: BlockRendererDefinition<
			BlockValues<TApp, TBlockName>,
			BlockPrefetchData<TApp, TBlockName>
		>,
	): BlockRegistry<
		TApp,
		TRegistered & {
			[K in TBlockName]: BlockRendererDefinition<
				BlockValues<TApp, TBlockName>,
				BlockPrefetchData<TApp, TBlockName>
			>;
		}
	>;

	/**
	 * Get the registered renderers.
	 */
	readonly renderers: TRegistered;

	/**
	 * Get a renderer by block name (runtime).
	 */
	getRenderer(blockName: string): BlockRendererDefinition<any, any> | undefined;

	/**
	 * Check if a block has a registered renderer (runtime).
	 */
	hasRenderer(blockName: string): boolean;

	/**
	 * Get all registered block names (runtime).
	 */
	getBlockNames(): string[];

	/**
	 * Render a block by name (runtime helper).
	 */
	renderBlock(
		blockName: string,
		props: Omit<BlockRendererProps<any, any>, "children">,
		children?: React.ReactNode,
	): React.ReactNode;
}

// ============================================================================
// Registry Implementation
// ============================================================================

/**
 * Internal class implementing BlockRegistry.
 */
class BlockRegistryImpl<
	TApp,
	TRegistered extends Record<string, BlockRendererDefinition<any, any>>,
> implements BlockRegistry<TApp, TRegistered>
{
	constructor(public readonly renderers: TRegistered = {} as TRegistered) {}

	register<TBlockName extends ServerBlockNames<TApp> & string>(
		blockName: TBlockName,
		definition: BlockRendererDefinition<
			BlockValues<TApp, TBlockName>,
			BlockPrefetchData<TApp, TBlockName>
		>,
	): BlockRegistry<
		TApp,
		TRegistered & {
			[K in TBlockName]: BlockRendererDefinition<
				BlockValues<TApp, TBlockName>,
				BlockPrefetchData<TApp, TBlockName>
			>;
		}
	> {
		return new BlockRegistryImpl({
			...this.renderers,
			[blockName]: definition,
		} as any);
	}

	getRenderer(
		blockName: string,
	): BlockRendererDefinition<any, any> | undefined {
		return (
			this.renderers as Record<string, BlockRendererDefinition<any, any>>
		)[blockName];
	}

	hasRenderer(blockName: string): boolean {
		return blockName in this.renderers;
	}

	getBlockNames(): string[] {
		return Object.keys(this.renderers);
	}

	renderBlock(
		blockName: string,
		props: Omit<BlockRendererProps<any, any>, "children">,
		children?: React.ReactNode,
	): React.ReactNode {
		const renderer = this.getRenderer(blockName);
		if (!renderer) {
			console.warn(`No renderer registered for block type: ${blockName}`);
			return null;
		}
		const Component = renderer.component;
		return <Component {...props}>{children}</Component>;
	}
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new type-safe block renderer registry.
 *
 * The registry infers block value types from the server app type,
 * ensuring type safety without duplicating schema definitions.
 *
 * @template TApp - Server app type (e.g., `typeof app` or `App`)
 *
 * @example
 * ```ts
 * import { createBlockRegistry } from "@questpie/admin/client";
 * import type { App } from "@/server/app";
 *
 * // Create typed registry
 * export const blockRenderers = createBlockRegistry<App>()
 *   .register("hero", {
 *     // values is typed: { title: string, subtitle?: string, ... }
 *     // data is typed from prefetch return type
 *     component: ({ values, data }) => (
 *       <section>
 *         <h1>{values.title}</h1>
 *         {values.subtitle && <p>{values.subtitle}</p>}
 *       </section>
 *     ),
 *   })
 *   .register("columns", {
 *     component: ({ values, children }) => (
 *       <div className={`grid grid-cols-${values.columnCount}`}>
 *         {children}
 *       </div>
 *     ),
 *   });
 *
 * // Use in BlockRenderer component
 * function BlockRenderer({ block }: { block: BlockNode }) {
 *   return blockRenderers.renderBlock(
 *     block.type,
 *     { id: block.id, values: blockValues[block.id], data: blockData[block.id] },
 *     block.children.map(child => <BlockRenderer key={child.id} block={child} />)
 *   );
 * }
 * ```
 */
export function createBlockRegistry<TApp>(): BlockRegistry<
	TApp,
	Record<string, never>
> {
	return new BlockRegistryImpl<TApp, Record<string, never>>();
}

// ============================================================================
// Utility Types for Advanced Usage
// ============================================================================

/**
 * Extract the component props type for a registered block.
 * Useful when you need to type component props externally.
 *
 * @example
 * ```ts
 * type HeroProps = BlockComponentProps<App, "hero">;
 * // { id: string; values: HeroValues; data: HeroData; children?: ReactNode; ... }
 * ```
 */
export type BlockComponentProps<
	TApp,
	TBlockName extends ServerBlockNames<TApp>,
> = BlockRendererProps<
	BlockValues<TApp, TBlockName>,
	BlockPrefetchData<TApp, TBlockName>
>;

/**
 * Helper type to get all possible block value types from app.
 * Useful for union types or discriminated unions.
 *
 * @example
 * ```ts
 * type AnyBlockValues = AllBlockValues<App>;
 * // { hero: HeroValues; text: TextValues; columns: ColumnsValues; ... }
 * ```
 */
export type AllBlockValues<TApp> = {
	[K in ServerBlockNames<TApp> & string]: BlockValues<TApp, K>;
};

/**
 * Helper type to get all possible block data types from app.
 *
 * @example
 * ```ts
 * type AnyBlockData = AllBlockData<App>;
 * // { hero: HeroData; featuredPosts: { posts: Post[] }; ... }
 * ```
 */
export type AllBlockData<TApp> = {
	[K in ServerBlockNames<TApp> & string]: BlockPrefetchData<TApp, K>;
};
