/**
 * Block Library Sidebar
 *
 * Drawer component for selecting block types to add.
 * Uses shadcn Sheet component for mobile-friendly sidebar.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";
import type { BlockCategoryConfig, BlockSchema } from "#questpie/admin/server";
import { cn } from "../../lib/utils.js";
import { Input } from "../ui/input.js";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet.js";
import {
	useBlockEditorActions,
	useBlockEditorState,
} from "./block-editor-context.js";
import { BlockIcon } from "./block-type-icon.js";

// ============================================================================
// Types
// ============================================================================

export type BlockLibrarySidebarProps = {
	/** Whether the sidebar is open */
	open: boolean;
	/** Callback when sidebar closes */
	onClose: () => void;
};

type BlockWithName = BlockSchema & { name: string };

type CategoryInfo = {
	key: string;
	config: BlockCategoryConfig;
	blocks: BlockWithName[];
};

// ============================================================================
// Component
// ============================================================================

export function BlockLibrarySidebar({
	open,
	onClose,
}: BlockLibrarySidebarProps) {
	const state = useBlockEditorState();
	const actions = useBlockEditorActions();
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
			categoryMap.get(key)?.blocks.push({ ...def, name });
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

	// Focus search on open
	const searchInputRef = React.useRef<HTMLInputElement>(null);
	React.useEffect(() => {
		if (open) {
			const timer = setTimeout(() => searchInputRef.current?.focus(), 100);
			return () => clearTimeout(timer);
		}
	}, [open]);

	// Handle block selection
	const handleSelectBlock = (type: string) => {
		if (state.insertPosition) {
			actions.addBlock(type, state.insertPosition);
		}
		onClose();
		setSearch("");
	};

	return (
		<Sheet open={open} onOpenChange={onClose}>
			<SheetContent side="left" className="w-full sm:max-w-md flex flex-col">
				<SheetHeader className="space-y-2">
					<SheetTitle>Add Block</SheetTitle>
					<SheetDescription>
						Select a block type to add to your content
					</SheetDescription>
				</SheetHeader>

				{/* Search */}
				<div className="px-6 py-4">
					<div className="relative">
						<Icon
							icon="ph:magnifying-glass"
							className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							ref={searchInputRef}
							placeholder="Search blocks..."
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9"
						/>
					</div>
				</div>

				{/* Block list by category */}
				<div className="flex-1 overflow-y-auto px-6 pb-6">
					{categories.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<Icon
								icon="ph:cube"
								className="h-12 w-12 text-muted-foreground/50 mb-4"
							/>
							<p className="text-sm text-muted-foreground">No blocks found</p>
							{search && (
								<p className="text-xs text-muted-foreground mt-1">
									Try a different search term
								</p>
							)}
						</div>
					) : (
						<div className="space-y-6">
							{categories.map((category) => (
								<div key={category.key}>
									{/* Category header */}
									<div className="mb-3 flex items-center gap-2">
										{category.config.icon && (
											<Icon
												icon={category.config.icon.props.name as string}
												className="h-4 w-4 text-muted-foreground"
											/>
										)}
										<h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
											{getCategoryDisplayLabel(category.config)}
										</h4>
									</div>

									{/* Blocks grid */}
									<div className="grid grid-cols-2 gap-2">
										{category.blocks.map((block) => (
											<button
												type="button"
												key={block.name}
												className={cn(
													"flex flex-col items-start gap-2 rounded-md border p-3 text-left",
													"transition-colors hover:border-primary hover:bg-accent",
													"focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
												)}
												onClick={() => handleSelectBlock(block.name)}
											>
												<BlockIcon
													icon={block.admin?.icon}
													size={20}
													className="text-muted-foreground"
												/>
												<div className="min-w-0">
													<p className="text-sm font-medium truncate">
														{getBlockDisplayLabel(block)}
													</p>
													{block.admin?.description && (
														<p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
															{getDescriptionText(block.admin.description)}
														</p>
													)}
												</div>
											</button>
										))}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

// ============================================================================
// Helpers
// ============================================================================

import type { I18nText } from "../../i18n/types.js";

function getBlockDisplayLabel(block: BlockSchema & { name: string }): string {
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

function getDescriptionText(description: I18nText | undefined): string {
	if (!description) return "";

	if (typeof description === "string") {
		return description;
	}

	if (typeof description === "function") {
		return "";
	}

	if ("key" in description) {
		return description.fallback || "";
	}

	const localeMap = description as Record<string, string>;
	return localeMap.en || Object.values(localeMap)[0] || "";
}
