/**
 * Block Item Menu
 *
 * Shared menu items for block context menu and dropdown.
 * Provides actions like duplicate, delete, add child, etc.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import { useTranslation } from "../../i18n/hooks.js";
import { Button } from "../ui/button.js";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "../ui/context-menu.js";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu.js";
import { useBlockEditor } from "./block-editor-context.js";
import { BlockTypeIcon } from "./block-type-icon.js";
import { findBlockById, findBlockPosition } from "./utils/tree-utils.js";

// ============================================================================
// Types
// ============================================================================

export interface BlockItemMenuProps {
	/** Block ID */
	blockId: string;
	/** Whether this block can have children */
	canHaveChildren: boolean;
	/** Callback for duplicate */
	onDuplicate: () => void;
	/** Callback for remove */
	onRemove: () => void;
}

// ============================================================================
// Shared Menu Content
// ============================================================================

interface MenuItemsProps extends BlockItemMenuProps {
	/** Render function for menu item */
	MenuItem: React.ComponentType<{
		onClick?: () => void;
		variant?: "default" | "destructive";
		children: React.ReactNode;
	}>;
	/** Render function for separator */
	Separator: React.ComponentType;
	/** Render function for submenu */
	SubMenu: React.ComponentType<{ children: React.ReactNode }>;
	/** Render function for submenu trigger */
	SubMenuTrigger: React.ComponentType<{ children: React.ReactNode }>;
	/** Render function for submenu content */
	SubMenuContent: React.ComponentType<{ children: React.ReactNode }>;
	/** Close the menu */
	onClose?: () => void;
}

function MenuItems({
	blockId,
	canHaveChildren,
	onDuplicate,
	onRemove,
	MenuItem,
	Separator,
	SubMenu,
	SubMenuTrigger,
	SubMenuContent,
	onClose,
}: MenuItemsProps) {
	const { t } = useTranslation();
	const { state, actions } = useBlockEditor();

	// Get available block types for add actions
	const blockTypes = React.useMemo(() => {
		return Object.entries(state.blocks)
			.filter(([type]) => {
				if (!state.allowedBlocks) return true;
				return state.allowedBlocks.includes(type);
			})
			.map(([type, def]) => ({
				type,
				label: getBlockLabel(def),
			}))
			.sort((a, b) => a.label.localeCompare(b.label));
	}, [state.blocks, state.allowedBlocks]);

	const blockPosition = React.useMemo(
		() => findBlockPosition(state.content._tree, blockId),
		[state.content._tree, blockId],
	);

	const handleAddChild = (blockType: string) => {
		// Find current block to get children count
		const block = findBlockById(state.content._tree, blockId);
		const childrenCount = block?.children.length ?? 0;

		actions.addBlock(blockType, {
			parentId: blockId,
			index: childrenCount,
		});

		// Make sure block is expanded
		if (!state.expandedBlockIds.has(blockId)) {
			actions.toggleExpanded(blockId);
		}

		onClose?.();
	};

	const handleAddAbove = (blockType: string) => {
		if (!blockPosition) return;
		actions.addBlock(blockType, {
			parentId: blockPosition.parentId,
			index: blockPosition.index,
		});
		onClose?.();
	};

	const handleAddBelow = (blockType: string) => {
		if (!blockPosition) return;
		actions.addBlock(blockType, {
			parentId: blockPosition.parentId,
			index: blockPosition.index + 1,
		});
		onClose?.();
	};

	const handleDuplicate = () => {
		onDuplicate();
		onClose?.();
	};

	const handleRemove = () => {
		onRemove();
		onClose?.();
	};

	return (
		<>
			{blockTypes.length > 0 && blockPosition && (
				<>
					<SubMenu>
						<SubMenuTrigger>
							<Icon icon="ph:arrow-up" className="h-4 w-4" />
							{t("blocks.addAbove")}
						</SubMenuTrigger>
						<SubMenuContent>
							{blockTypes.map(({ type, label }) => (
								<MenuItem key={type} onClick={() => handleAddAbove(type)}>
									<BlockTypeIcon type={type} className="h-4 w-4" />
									{label}
								</MenuItem>
							))}
						</SubMenuContent>
					</SubMenu>
					<SubMenu>
						<SubMenuTrigger>
							<Icon icon="ph:arrow-down" className="h-4 w-4" />
							{t("blocks.addBelow")}
						</SubMenuTrigger>
						<SubMenuContent>
							{blockTypes.map(({ type, label }) => (
								<MenuItem key={type} onClick={() => handleAddBelow(type)}>
									<BlockTypeIcon type={type} className="h-4 w-4" />
									{label}
								</MenuItem>
							))}
						</SubMenuContent>
					</SubMenu>
					{canHaveChildren && (
						<SubMenu>
							<SubMenuTrigger>
								<Icon icon="ph:plus" className="h-4 w-4" />
								{t("blocks.addChild")}
							</SubMenuTrigger>
							<SubMenuContent>
								{blockTypes.map(({ type, label }) => (
									<MenuItem key={type} onClick={() => handleAddChild(type)}>
										<BlockTypeIcon type={type} className="h-4 w-4" />
										{label}
									</MenuItem>
								))}
							</SubMenuContent>
						</SubMenu>
					)}
					<Separator />
				</>
			)}

			{/* Duplicate */}
			<MenuItem onClick={handleDuplicate}>
				<Icon icon="ph:copy" className="h-4 w-4" />
				{t("common.duplicate")}
			</MenuItem>

			<Separator />

			{/* Delete */}
			<MenuItem variant="destructive" onClick={handleRemove}>
				<Icon icon="ph:trash" className="h-4 w-4" />
				{t("common.delete")}
			</MenuItem>
		</>
	);
}

// ============================================================================
// Context Menu Wrapper
// ============================================================================

export interface BlockItemContextMenuProps extends BlockItemMenuProps {
	children: React.ReactNode;
}

export function BlockItemContextMenu({
	children,
	...menuProps
}: BlockItemContextMenuProps) {
	return (
		<ContextMenu>
			<ContextMenuTrigger className="block">{children}</ContextMenuTrigger>
			<ContextMenuContent>
				<MenuItems
					{...menuProps}
					MenuItem={ContextMenuItem}
					Separator={ContextMenuSeparator}
					SubMenu={ContextMenuSub}
					SubMenuTrigger={ContextMenuSubTrigger}
					SubMenuContent={ContextMenuSubContent}
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

// ============================================================================
// Dropdown Menu Button
// ============================================================================

export interface BlockItemDropdownMenuProps extends BlockItemMenuProps {
	className?: string;
}

export function BlockItemDropdownMenu({
	className,
	...menuProps
}: BlockItemDropdownMenuProps) {
	const [open, setOpen] = React.useState(false);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="icon"
						className={className}
						onClick={(e) => e.stopPropagation()}
					/>
				}
			>
				<Icon icon="ph:dots-three-vertical" className="h-4 w-4" />
				<span className="sr-only">Block actions</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<MenuItems
					{...menuProps}
					MenuItem={DropdownMenuItem}
					Separator={DropdownMenuSeparator}
					SubMenu={DropdownMenuSub}
					SubMenuTrigger={DropdownMenuSubTrigger}
					SubMenuContent={DropdownMenuSubContent}
					onClose={() => setOpen(false)}
				/>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ============================================================================
// Helpers
// ============================================================================

import type { BlockSchema } from "#questpie/admin/server";

function getBlockLabel(blockDef: BlockSchema): string {
	const label = blockDef.admin?.label;

	if (!label) {
		return blockDef.name || "Block";
	}

	if (typeof label === "string") {
		return label;
	}

	if ("key" in label) {
		return label.fallback || blockDef.name || "Block";
	}

	// I18nLocaleMap
	return label.en || Object.values(label)[0] || blockDef.name || "Block";
}
