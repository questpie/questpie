/**
 * Block Tree
 *
 * Renders a list of blocks with drag-and-drop support and rail visual for hierarchy.
 */

"use client";

import {
	SortableContext,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import * as React from "react";
import type { BlockNode } from "../../blocks/types.js";
import { cn } from "../../lib/utils.js";
import { BlockInsertButton } from "./block-insert-button.js";
import { BlockItem } from "./block-item.js";

// ============================================================================
// Types
// ============================================================================

export type BlockTreeProps = {
	/** Block nodes to render */
	blocks: BlockNode[];
	/** Nesting level (0 = root) */
	level: number;
	/** Parent block ID (null = root) */
	parentId: string | null;
	/** Custom class name */
	className?: string;
};

// ============================================================================
// Component
// ============================================================================

export function BlockTree({
	blocks,
	level,
	parentId,
	className,
}: BlockTreeProps) {
	// Get block IDs for sortable context
	const blockIds = React.useMemo(() => blocks.map((b) => b.id), [blocks]);

	const isRoot = level === 0;

	return (
		<div className={cn("space-y-2", className)}>
			<SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
				{blocks.map((block, index) => (
					<BlockItem
						key={block.id}
						block={block}
						level={level}
						index={index}
						parentId={parentId}
					/>
				))}
			</SortableContext>

			{/* Add block at end - only for root level */}
			{isRoot && (
				<div className="mt-4">
					<BlockInsertButton
						position={{ parentId, index: blocks.length }}
						variant="default"
					/>
				</div>
			)}
		</div>
	);
}
