/**
 * BlockRenderer Component
 *
 * Renders a tree of blocks using registered block definitions.
 * Each block type has a renderer component that receives the block's values.
 *
 * @example
 * ```tsx
 * import { BlockRenderer } from "@questpie/admin/client";
 * import { blocks } from "~/admin/blocks";
 *
 * function PageContent({ page }) {
 *   return (
 *     <BlockRenderer
 *       content={page.content}
 *       blocks={blocks}
 *     />
 *   );
 * }
 * ```
 */

import type * as React from "react";
import { BlockScopeProvider } from "../preview/block-scope-context.js";
import type { BlockContent, BlockNode } from "./types";

// Module-level constant for empty object to avoid recreating on each render
const EMPTY_DATA: Record<string, unknown> = {};

/**
 * Block renderer function type.
 * Consumers provide their own renderers mapped by block type.
 */
export type BlockRendererFn = (props: {
	id: string;
	type: string;
	values: Record<string, unknown>;
	data?: Record<string, unknown>;
	children?: React.ReactNode;
}) => React.ReactNode;

/**
 * Props for BlockRenderer component.
 */
export type BlockRendererProps = {
	/** Block content from API (tree + values) */
	content: BlockContent;
	/** Block renderers mapped by type */
	renderers: Record<string, BlockRendererFn>;
	/** Prefetched data by block ID (optional, for SSR) */
	data?: Record<string, unknown>;
	/** Currently selected block ID (for editor mode) */
	selectedBlockId?: string | null;
	/** Block click handler (for editor mode) */
	onBlockClick?: (blockId: string) => void;
	/** Custom class name for the container */
	className?: string;
};

/**
 * Renders a tree of blocks.
 *
 * Iterates through the block tree and renders each block using its
 * registered renderer component. Layout blocks receive their rendered
 * children as the `children` prop.
 */
export function BlockRenderer({
	content,
	renderers,
	data,
	selectedBlockId,
	onBlockClick,
	className,
}: BlockRendererProps) {
	const resolvedData = data ?? EMPTY_DATA;
	/**
	 * Recursively render a block node.
	 */
	function renderBlock(node: BlockNode): React.ReactNode {
		const renderFn = renderers[node.type];

		if (!renderFn) {
			if (process.env.NODE_ENV !== "production") {
				console.warn(
					`[BlockRenderer] No renderer found for block type "${node.type}"`,
				);
			}
			return null;
		}

		const values = content._values[node.id] || {};
		const blockData = resolvedData[node.id] as
			| Record<string, unknown>
			| undefined;
		const isSelected = selectedBlockId === node.id;

		// Render children for layout blocks
		const renderedChildren =
			node.children.length > 0 ? node.children.map(renderBlock) : undefined;

		const handleClick = onBlockClick
			? (e: React.MouseEvent) => {
					e.stopPropagation();
					onBlockClick(node.id);
				}
			: undefined;

		const blockElement = (
			<BlockScopeProvider blockId={node.id} basePath="content._values">
				{renderFn({
					id: node.id,
					type: node.type,
					values,
					data: blockData,
					children: renderedChildren,
				})}
			</BlockScopeProvider>
		);

		// Wrap in interactive container when in editor mode
		if (handleClick) {
			return (
				<div
					key={node.id}
					data-block-id={node.id}
					data-block-type={node.type}
					onClick={handleClick}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onBlockClick?.(node.id);
						}
					}}
					role="button"
					tabIndex={0}
					className="cursor-pointer"
				>
					{blockElement}
				</div>
			);
		}

		return (
			<div key={node.id} data-block-id={node.id} data-block-type={node.type}>
				{blockElement}
			</div>
		);
	}

	if (!content?._tree?.length) {
		return null;
	}

	return <div className={className}>{content._tree.map(renderBlock)}</div>;
}

export default BlockRenderer;
