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
import type { BlockDefinition } from "../builder/block/types";
import type { BlockContent, BlockNode } from "./types";
import { BlockScopeProvider } from "../preview/block-scope-context.js";

/**
 * Props for BlockRenderer component.
 */
export type BlockRendererProps = {
  /** Block content from API (tree + values) */
  content: BlockContent;
  /** Registered block definitions */
  blocks: Record<string, BlockDefinition>;
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
  blocks,
  data = {},
  selectedBlockId,
  onBlockClick,
  className,
}: BlockRendererProps) {
  /**
   * Recursively render a block node.
   */
  function renderBlock(node: BlockNode): React.ReactNode {
    const blockDef = blocks[node.type];

    if (!blockDef?.renderer) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[BlockRenderer] Block type "${node.type}" not found or has no renderer`,
        );
      }
      return null;
    }

    const Component = blockDef.renderer;
    const values = content._values[node.id] || {};
    const blockData = data[node.id];
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
        <Component
          id={node.id}
          values={values}
          data={blockData}
          isSelected={isSelected}
          isPreview={false}
        >
          {renderedChildren}
        </Component>
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
