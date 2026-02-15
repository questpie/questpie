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
import { Button } from "../ui/button.js";
import {
	useBlockEditor,
	useBlockEditorActions,
} from "./block-editor-context.js";
import { BlockTree } from "./block-tree.js";
import { BlockIcon } from "./block-type-icon.js";
import { findBlockById, findBlockPosition } from "./utils/tree-utils.js";

// ============================================================================
// Component
// ============================================================================

export function BlockCanvas() {
	const { state } = useBlockEditor();
	const actions = useBlockEditorActions();
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
	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	// Handle drag end
	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveId(null);

		if (!over || active.id === over.id) {
			return;
		}

		const activeId = active.id as string;
		const overId = over.id as string;

		// Find positions of both blocks
		const activePosition = findBlockPosition(state.content._tree, activeId);
		const overPosition = findBlockPosition(state.content._tree, overId);

		if (!activePosition || !overPosition) {
			return;
		}

		// Calculate new index based on relative positions
		// If moving within same parent
		if (activePosition.parentId === overPosition.parentId) {
			// If dragging down (active index < over index), insert at over's position
			// If dragging up (active index > over index), insert at over's position
			const newIndex =
				activePosition.index < overPosition.index
					? overPosition.index
					: overPosition.index;

			actions.moveBlock(activeId, {
				parentId: overPosition.parentId,
				index: newIndex,
			});
		} else {
			// Moving to different parent - insert at over's position
			actions.moveBlock(activeId, {
				parentId: overPosition.parentId,
				index: overPosition.index,
			});
		}
	};

	// Get active block for overlay
	const activeBlock = activeId
		? findBlockById(state.content._tree, activeId)
		: null;
	const activeBlockSchema = activeBlock ? state.blocks[activeBlock.type] : null;

	// Empty state
	if (state.content._tree.length === 0) {
		return (
			<div className="flex h-full flex-col items-center justify-center p-8">
				<div className="mb-6 text-center text-muted-foreground">
					<Icon
						icon="ph:stack"
						className="mx-auto h-16 w-16 text-muted-foreground/30 mb-4"
					/>
					<p className="text-lg font-medium">No blocks yet</p>
					<p className="text-sm mt-1">Add your first block to get started</p>
				</div>
				<Button
					variant="default"
					size="lg"
					onClick={() => actions.openLibrary({ parentId: null, index: 0 })}
				>
					<Icon icon="ph:plus" className="mr-2 h-5 w-5" />
					Add block
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<DndContext
				sensors={sensors}
				collisionDetection={closestCenter}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<BlockTree blocks={state.content._tree} level={0} parentId={null} />

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
		</div>
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
