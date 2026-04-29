/**
 * Block Item
 *
 * Single block item with inline editable fields.
 * Click header to expand/collapse, drag handle for reordering.
 */

"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@iconify/react";
import * as React from "react";

import type { BlockNode } from "../../blocks/types.js";
import { useTranslation } from "../../i18n/hooks.js";
import { cn } from "../../lib/utils.js";
import { Card, CardContent, CardHeader } from "../ui/card.js";
import {
	useBlockEditorActions,
	useBlockSchema,
	useBlockValues,
	useIsBlockExpanded,
} from "./block-editor-context.js";
import { BlockFieldsRenderer } from "./block-fields-renderer.js";
import { BlockInsertButton } from "./block-insert-button.js";
import { BlockItemDropdownMenu } from "./block-item-menu.js";
import { BlockTree } from "./block-tree.js";
import { BlockIcon } from "./block-type-icon.js";

// ============================================================================
// Types
// ============================================================================

type BlockItemProps = {
	/** Block node data */
	block: BlockNode;
	/** Nesting level (0 = root) */
	level: number;
	/** Index in parent's children */
	index: number;
	/** Parent block ID (null = root) */
	parentId: string | null;
};

// ============================================================================
// Component
// ============================================================================

function areBlockItemPropsEqual(
	prev: BlockItemProps,
	next: BlockItemProps,
): boolean {
	return (
		prev.block === next.block &&
		prev.level === next.level &&
		prev.index === next.index &&
		prev.parentId === next.parentId
	);
}

export const BlockItem = React.memo(function BlockItem({
	block,
	level,
	index: _index,
	parentId: _parentId,
}: BlockItemProps) {
	const { t } = useTranslation();
	const actions = useBlockEditorActions();
	const blockSchema = useBlockSchema(block.type);
	const values = useBlockValues(block.id);
	const isExpanded = useIsBlockExpanded(block.id);
	const isUnknownType = !blockSchema;
	const canHaveChildren = blockSchema?.allowChildren ?? false;

	// Drag and drop
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
		isOver,
		active,
	} = useSortable({ id: block.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	// Show drop indicator when dragging over this item (but not self)
	const showDropIndicator = isOver && active?.id !== block.id;

	// Get block label from values or definition
	const blockLabel = getBlockLabel(block, blockSchema, values);

	// Handlers
	const handleToggleExpand = (e: React.MouseEvent) => {
		// Don't toggle if clicking on drag handle or actions
		const target = e.target as HTMLElement;
		if (
			target.closest("[data-drag-handle]") ||
			target.closest("[data-actions-menu]")
		) {
			return;
		}
		actions.toggleExpanded(block.id);
	};

	const handleDuplicate = React.useCallback(() => {
		actions.duplicateBlock(block.id);
	}, [actions, block.id]);

	const handleRemove = React.useCallback(() => {
		actions.removeBlock(block.id);
	}, [actions, block.id]);

	// Keyboard handler for header
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			actions.toggleExpanded(block.id);
		}
	};

	const isRoot = level === 0;

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn("relative", isDragging && "opacity-50")}
		>
			{/* Drop indicator line */}
			{showDropIndicator && (
				<div className="bg-primary absolute -top-0.5 right-0 left-0 z-10 h-0.5" />
			)}

			{/* Block card */}
			<Card
				className={cn(
					"gap-0 overflow-hidden p-0 transition-shadow",
					isUnknownType && "border-destructive/50",
				)}
			>
				{/* Header - clickable to expand/collapse */}
				<CardHeader
					role="button"
					tabIndex={0}
					className={cn(
						"group flex cursor-pointer flex-row items-center gap-2 px-3 py-2 select-none",
						"hover:bg-muted transition-colors",
						"focus-visible:ring-ring/25 focus-visible:ring-3 focus-visible:outline-none focus-visible:ring-inset",
					)}
					onClick={handleToggleExpand}
					onKeyDown={handleKeyDown}
				>
					{/* Drag handle */}
					<button
						type="button"
						data-drag-handle
						className="hover:bg-muted -ml-1 cursor-grab rounded p-1 active:cursor-grabbing"
						{...attributes}
						{...listeners}
						onClick={(e) => e.stopPropagation()}
					>
						<Icon
							icon="ph:dots-six-vertical"
							className="text-muted-foreground h-4 w-4"
						/>
					</button>

					{/* Expand/collapse icon */}
					<div className="text-muted-foreground">
						<Icon
							icon={"ph:caret-right"}
							className={cn(
								"h-4 w-4 transition-transform duration-150 ease-in-out",
								isExpanded && "rotate-90",
							)}
						/>
					</div>

					{/* Block icon */}
					{isUnknownType ? (
						<Icon icon="ph:warning" className="text-destructive h-3.5 w-3.5" />
					) : (
						<BlockIcon
							icon={blockSchema?.admin?.icon}
							size={14}
							className={isRoot ? "text-foreground" : "text-muted-foreground"}
						/>
					)}

					{/* Block label */}
					<div className="flex min-w-0 flex-1 items-baseline gap-2">
						<span
							className={cn(
								"truncate text-sm font-medium",
								isUnknownType
									? "text-destructive"
									: isRoot
										? "text-foreground"
										: "text-foreground/90",
							)}
						>
							{blockLabel}
						</span>
						{/* Show preview text if available */}
						{values && (
							<span className="text-muted-foreground hidden truncate text-xs sm:inline">
								{getPreviewText(values)}
							</span>
						)}
					</div>

					{/* Actions menu */}
					<div data-actions-menu>
						<BlockItemDropdownMenu
							blockId={block.id}
							canHaveChildren={canHaveChildren}
							onDuplicate={handleDuplicate}
							onRemove={handleRemove}
							className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
						/>
					</div>
				</CardHeader>

				{/* Body with inline fields - only when expanded */}
				{isExpanded && blockSchema && (
					<CardContent className={cn("p-3", !isRoot && "py-2")}>
						<BlockFieldsRenderer blockId={block.id} blockSchema={blockSchema} />
					</CardContent>
				)}

				{/* Unknown block type warning */}
				{isExpanded && isUnknownType && (
					<CardContent className="p-3">
						<div className="text-destructive flex items-center gap-2 text-sm">
							<Icon icon="ph:warning" className="h-4 w-4 shrink-0" />
							<span>{t("blocks.unknownType", { type: block.type })}</span>
						</div>
					</CardContent>
				)}
			</Card>

			{/* Children with rail */}
			{canHaveChildren && isExpanded && block.children.length > 0 && (
				<div className="relative">
					{/* Rail line */}
					<div className="bg-border absolute top-0 bottom-0 left-3 w-px" />
					<div className="space-y-2 pt-2 pl-8">
						<BlockTree
							blocks={block.children}
							level={level + 1}
							parentId={block.id}
						/>
					</div>
				</div>
			)}

			{/* Add child button - only for blocks that can have children */}
			{canHaveChildren && isExpanded && (
				<div className="relative mt-2 pl-8">
					<div className="bg-border absolute -top-2 left-3 h-[calc(50%+8px)] w-px" />
					{/* Horizontal rail connector */}
					<div className="bg-border absolute top-1/2 left-3 h-px w-5" />
					<BlockInsertButton
						position={{ parentId: block.id, index: block.children.length }}
						variant="rail"
						parentLabel={blockLabel}
					/>
				</div>
			)}
		</div>
	);
}, areBlockItemPropsEqual);

// ============================================================================
// Helpers
// ============================================================================

import type { BlockSchema } from "#questpie/admin/server/block/index.js";

function getBlockLabel(
	block: BlockNode,
	blockSchema: BlockSchema | undefined,
	values: Record<string, unknown> | undefined,
): string {
	// Try to get meaningful label from values
	if (values) {
		const title = values.title || values.name || values.label || values.heading;
		if (title && typeof title === "string") {
			return title.slice(0, 50);
		}
	}

	// Fall back to block type label
	const label = blockSchema?.admin?.label;
	if (label) {
		// Handle string directly
		if (typeof label === "string") {
			return label;
		}

		// Handle key-based translation object
		if ("key" in label) {
			return label.fallback || block.type;
		}

		// Handle I18nLocaleMap - use English or first available
		const localeLabel = label.en;
		if (localeLabel) {
			return localeLabel;
		}
		const firstValue = Object.values(label)[0];
		if (typeof firstValue === "string") {
			return firstValue;
		}
	}

	// Fall back to type name
	return block.type.charAt(0).toUpperCase() + block.type.slice(1);
}

function getPreviewText(values: Record<string, unknown>): string {
	// Extract a short preview from common fields
	const previewFields = [
		"subtitle",
		"description",
		"text",
		"caption",
		"summary",
	];
	for (const field of previewFields) {
		const value = values[field];
		if (value && typeof value === "string") {
			const text = value.slice(0, 60);
			return text.length < (value as string).length ? `${text}...` : text;
		}
	}
	return "";
}
