/**
 * Block Canvas
 *
 * Main canvas area for displaying and editing the block tree.
 * Supports drag-and-drop reordering and inline field editing.
 */

"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Icon } from "@iconify/react";
import * as React from "react";
import { RenderProfiler } from "../../lib/render-profiler.js";
import {
	useBlockEditorActions,
	useBlockRegistry,
	useBlockTree,
} from "./block-editor-context.js";
import { BlockTree } from "./block-tree.js";
import { BlockIcon } from "./block-type-icon.js";
import { findBlockById, findBlockPosition } from "./utils/tree-utils.js";

// ============================================================================
// Component
// ============================================================================

export function BlockCanvas() {
	const actions = useBlockEditorActions();
	const tree = useBlockTree();
	const blocksByType = useBlockRegistry();
	const [activeId, setActiveId] = React.useState<string | null>(null);

	// Configure drag sensors with keyboard support
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 8, // Require 8px of movement before starting drag
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	);

	// Handle drag start - track active item for overlay
	const handleDragStart = React.useCallback((event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	}, []);

	// Handle drag end - reorder within same parent only
	const handleDragEnd = React.useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			setActiveId(null);

			if (!over || active.id === over.id) {
				return;
			}

			const draggedId = active.id as string;
			const overId = over.id as string;

			// Find positions of both blocks
			const activePosition = findBlockPosition(tree, draggedId);
			const overPosition = findBlockPosition(tree, overId);

			if (!activePosition || !overPosition) {
				return;
			}

			// Only allow reordering within the same parent
			if (activePosition.parentId !== overPosition.parentId) {
				return;
			}

			actions.moveBlock(
				draggedId,
				activePosition.parentId,
				activePosition.index,
				overPosition.index,
			);
		},
		[actions, tree],
	);

	// Handle drag cancel - reset state
	const handleDragCancel = React.useCallback(() => {
		setActiveId(null);
	}, []);

	// Get active block for overlay
	const activeBlock = React.useMemo(
		() => (activeId ? findBlockById(tree, activeId) : null),
		[activeId, tree],
	);
	const activeBlockSchema = React.useMemo(
		() => (activeBlock ? blocksByType[activeBlock.type] : null),
		[activeBlock, blocksByType],
	);

	return (
		<DndContext
			sensors={sensors}
			collisionDetection={closestCenter}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			onDragCancel={handleDragCancel}
		>
			<RenderProfiler id="blocks.tree" minDurationMs={8}>
				<BlockTree blocks={tree} level={0} parentId={null} />
			</RenderProfiler>

			{/* Drag overlay - shows what's being dragged */}
			<DragOverlay>
				{activeBlock && (
					<div className="flex items-center gap-2 rounded-md border bg-background p-2 shadow-lg">
						<Icon
							icon="ph:dots-six-vertical"
							className="h-4 w-4 text-muted-foreground"
						/>
						<BlockIcon
							icon={activeBlockSchema?.admin?.icon}
							size={16}
							className="text-muted-foreground"
						/>
						<span className="text-sm font-medium">
							{getBlockLabel(activeBlockSchema, activeBlock.type)}
						</span>
					</div>
				)}
			</DragOverlay>
		</DndContext>
	);
}

// ============================================================================
// Helpers
// ============================================================================

import type { BlockSchema } from "#questpie/admin/server";

function getBlockLabel(
	blockSchema: BlockSchema | null | undefined,
	type: string,
): string {
	if (!blockSchema) {
		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	const label = blockSchema.admin?.label;

	if (!label) {
		return type.charAt(0).toUpperCase() + type.slice(1);
	}

	if (typeof label === "string") return label;

	if (typeof label === "object" && label !== null) {
		if ("en" in label && typeof label.en === "string") return label.en;
		const first = Object.values(label)[0];
		if (typeof first === "string") return first;
	}

	return type.charAt(0).toUpperCase() + type.slice(1);
}
