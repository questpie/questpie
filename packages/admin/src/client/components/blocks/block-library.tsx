/**
 * Block Library
 *
 * Block picker component for adding new blocks.
 * Used both as standalone panel and as popover content.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { BlockCategoryConfig, BlockSchema } from "#questpie/admin/server";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { useBlockEditor, useBlockEditorState } from "./block-editor-context.js";
import { BlockIcon } from "./block-type-icon.js";

// ============================================================================
// Types
// ============================================================================

type BlockWithName = BlockSchema & { name: string };

type CategoryInfo = {
	key: string;
	config: BlockCategoryConfig;
	blocks: BlockWithName[];
};

export type BlockLibraryContentProps = {
	/** Callback when a block is selected */
	onSelect: (type: string) => void;
	/** Show header with close button */
	showHeader?: boolean;
	/** Close handler for header */
	onClose?: () => void;
};

// ============================================================================
// BlockLibraryContent - Reusable content for popover or panel
// ============================================================================

export function BlockLibraryContent({
	onSelect,
	showHeader = false,
	onClose,
}: BlockLibraryContentProps) {
	const state = useBlockEditorState();
	const [search, setSearch] = React.useState("");

	// Group blocks by category
	const categories = React.useMemo(() => {
		const categoryMap = new Map<string, CategoryInfo>();

		// Default uncategorized category
		const uncategorizedConfig: BlockCategoryConfig = {
			label: { en: "Other" },
			order: 999,
		};

		for (const [name, def] of Object.entries(state.blocks)) {
			// Filter by allowed blocks
			if (state.allowedBlocks && !state.allowedBlocks.includes(name)) {
				continue;
			}

			// Skip hidden blocks
			if (def.admin?.hidden) {
				continue;
			}

			// Filter by search
			if (search) {
				const label = getBlockDisplayLabel(def);
				if (!label.toLowerCase().includes(search.toLowerCase())) {
					continue;
				}
			}

			const categoryConfig = def.admin?.category;
			let key: string;
			let config: BlockCategoryConfig;

			if (categoryConfig) {
				key = getCategoryKey(categoryConfig);
				config = categoryConfig;
			} else {
				key = "uncategorized";
				config = uncategorizedConfig;
			}

			if (!categoryMap.has(key)) {
				categoryMap.set(key, { key, config, blocks: [] });
			}
			categoryMap.get(key)!.blocks.push({ ...def, name });
		}

		// Convert to array and sort
		const result = Array.from(categoryMap.values());

		// Sort categories by order
		result.sort((a, b) => (a.config.order ?? 999) - (b.config.order ?? 999));

		// Sort blocks within each category by order
		for (const category of result) {
			category.blocks.sort(
				(a, b) => (a.admin?.order ?? 999) - (b.admin?.order ?? 999),
			);
		}

		return result;
	}, [state.blocks, state.allowedBlocks, search]);

	// Focus search on mount
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
		return () => clearTimeout(timer);
	}, []);

	return (
		<div className="flex flex-col">
			{/* Optional Header */}
			{showHeader && (
				<div className="flex items-center justify-between border-b p-3">
					<h3 className="font-medium text-sm">Add Block</h3>
					{onClose && (
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
							onClick={onClose}
						>
							<Icon icon="ph:x" className="h-4 w-4" />
						</Button>
					)}
				</div>
			)}

			{/* Search */}
			<div className="p-3">
				<div className="relative">
					<Icon
						icon="ph:magnifying-glass"
						className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						ref={searchInputRef}
						placeholder="Search blocks..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-8 h-8 text-sm"
					/>
				</div>
			</div>

			{/* Block list by category */}
			<div className="max-h-64 overflow-auto px-3 pb-3">
				{categories.length === 0 ? (
					<div className="text-center text-sm text-muted-foreground py-4">
						No blocks found
					</div>
				) : (
					<div className="space-y-4">
						{categories.map((category) => (
							<div key={category.key}>
								<div className="mb-1.5 flex items-center gap-1.5">
									{category.config.icon && (
										<Icon
											icon={category.config.icon.props.name as string}
											className="h-3.5 w-3.5 text-muted-foreground"
										/>
									)}
									<h4 className="text-xs font-medium uppercase text-muted-foreground">
										{getCategoryDisplayLabel(category.config)}
									</h4>
								</div>
								<div className="grid grid-cols-2 gap-1.5">
									{category.blocks.map((block) => (
										<button
											type="button"
											key={block.name}
											className={cn(
												"flex items-center gap-2 rounded-md border p-2 text-left",
												"transition-colors hover:border-primary hover:bg-accent",
												"focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
											)}
											onClick={() => onSelect(block.name)}
										>
											<BlockIcon
												icon={block.admin?.icon}
												size={16}
												className="text-muted-foreground flex-shrink-0"
											/>
											<span className="text-xs truncate">
												{getBlockDisplayLabel(block)}
											</span>
										</button>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// BlockLibrary - Standalone panel version (legacy, for sidebar use)
// ============================================================================

export function BlockLibrary() {
	const { state, actions } = useBlockEditor();

	const handleSelect = (type: string) => {
		if (state.insertPosition) {
			actions.addBlock(type, state.insertPosition);
		}
	};

	return (
		<div className="h-full">
			<BlockLibraryContent
				onSelect={handleSelect}
				showHeader
				onClose={actions.closeLibrary}
			/>
		</div>
	);
}

// ============================================================================
// Helpers
// ============================================================================

function getBlockDisplayLabel(block: BlockSchema): string {
	const label = block.admin?.label;

	if (!label) {
		return block.name;
	}

	if (typeof label === "string") {
		return label;
	}

	if ("key" in label) {
		return label.fallback || block.name;
	}

	// I18nLocaleMap
	return label.en || Object.values(label)[0] || block.name;
}

function getCategoryKey(config: BlockCategoryConfig): string {
	const { label } = config;

	if (typeof label === "string") {
		return label.toLowerCase().replace(/\s+/g, "-");
	}

	if ("key" in label) {
		return label.key.toLowerCase().replace(/[.:]/g, "-");
	}

	// I18nLocaleMap
	const text = label.en ?? Object.values(label)[0] ?? "";
	return text.toLowerCase().replace(/\s+/g, "-");
}

function getCategoryDisplayLabel(config: BlockCategoryConfig): string {
	const { label } = config;

	if (typeof label === "string") {
		return label;
	}

	if ("key" in label) {
		return label.fallback || label.key;
	}

	// I18nLocaleMap
	return label.en || Object.values(label)[0] || "Other";
}
