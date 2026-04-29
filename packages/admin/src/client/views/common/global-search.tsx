/**
 * Global Search
 *
 * Fast navigation to collections, globals, quick actions, AND actual records.
 * Uses ResponsiveDialog for desktop (Dialog) and mobile (fullscreen Drawer).
 *
 * Features:
 * - Navigation items: Collections, globals, create actions (client-side filter)
 * - Record search: Full-text search across ALL collections (server-side)
 * - Keyboard navigation: ↑↓ arrows, Enter to select, Esc to close
 * - Highlights: Shows search term highlighted in record titles
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";

import type { ComponentReference } from "#questpie/admin/server/augmentation.js";

import { resolveIconElement } from "../../components/component-renderer";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "../../components/ui/input-group";
import { Kbd } from "../../components/ui/kbd";
import {
	ResponsiveDialog,
	ResponsiveDialogContent,
} from "../../components/ui/responsive-dialog";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useDebouncedValue, useGlobalSearch } from "../../hooks/use-search";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectBasePath, useAdminStore } from "../../runtime";

// ============================================================================
// Types
// ============================================================================

interface SearchItem {
	id: string;
	type: "collection" | "global" | "action" | "record";
	label: string;
	sublabel?: string;
	href: string;
	icon?:
		| ComponentReference
		| React.ComponentType<{ className?: string }>
		| string;
	keywords?: string[];
	highlights?: { title?: string };
}

interface GlobalSearchProps {
	isOpen: boolean;
	onClose: () => void;
	navigate: (path: string) => void;
	basePath?: string;
}

// ============================================================================
// Default Icon Names (for resolveIconElement)
// ============================================================================

const DEFAULT_FOLDER_ICON = "ph:folder";
const DEFAULT_GEAR_ICON = "ph:gear";
const DEFAULT_PLUS_ICON = "ph:plus";
const DEFAULT_FILE_ICON = "ph:file";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract typed props from server config entries (collections/globals).
 * Server config entries come as plain objects without strict typing.
 */
function getConfigProps(config: unknown) {
	const c = config as Record<string, any>;
	return {
		label: c?.label as string | undefined,
		icon: c?.icon as ComponentReference | undefined,
		hidden: c?.hidden as boolean | undefined,
	};
}

/**
 * Safe highlight renderer - escapes HTML and wraps query matches in <mark> tags.
 * Returns React elements instead of raw HTML to prevent XSS.
 */
function highlightText(text: string, query: string): React.ReactNode {
	if (!query.trim() || !text) return text;

	// Escape special regex characters in query
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regex = new RegExp(`(${escaped})`, "gi");
	const parts = text.split(regex);

	if (parts.length === 1) return text;

	return parts.map((part, i) =>
		i % 2 === 1
			? React.createElement(
					"mark",
					{
						key: i,
						className: "bg-accent text-accent-foreground rounded-xs px-0.5",
					},
					part,
				)
			: part,
	);
}

/**
 * Simple fuzzy search - matches if query words appear anywhere in text
 */
function fuzzyMatch(text: string, query: string): boolean {
	const textLower = text.toLowerCase();
	const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);

	return queryWords.every((word) => textLower.includes(word));
}

/**
 * Search and filter items based on query
 */
function filterItems(items: SearchItem[], query: string): SearchItem[] {
	if (!query.trim()) return items;

	return items.filter((item) => {
		// Match against label
		if (fuzzyMatch(item.label, query)) return true;

		// Match against keywords
		if (item.keywords?.some((kw) => fuzzyMatch(kw, query))) return true;

		return false;
	});
}

// ============================================================================
// Search Group Component
// ============================================================================

interface SearchGroupProps {
	title: string;
	items: SearchItem[];
	selectedIndex: number;
	startIndex: number;
	onSelect: (item: SearchItem) => void;
	onHover: (index: number) => void;
	query?: string;
}

const SearchGroup = React.memo(function SearchGroup({
	title,
	items,
	selectedIndex,
	startIndex,
	onSelect,
	onHover,
	query = "",
}: SearchGroupProps) {
	const resolveText = useResolveText();

	if (items.length === 0) return null;

	return (
		<div className="mb-4 last:mb-0">
			<h3 className="qa-global-search__group-title text-muted-foreground font-chrome chrome-meta mb-2 px-2.5 text-xs font-medium">
				{resolveText(title)}
			</h3>
			<div className="space-y-0.5">
				{items.map((item, idx) => {
					const globalIndex = startIndex + idx;
					const isSelected = globalIndex === selectedIndex;

					return (
						<button
							key={item.id}
							type="button"
							onClick={() => onSelect(item)}
							onMouseEnter={() => onHover(globalIndex)}
							data-selected={isSelected}
							className={cn(
								"item-surface flex w-full items-center gap-3 border-transparent px-3 py-2.5 text-sm transition-colors outline-none",
								isSelected
									? "border-border bg-accent text-accent-foreground"
									: "hover:border-border hover:bg-accent hover:text-accent-foreground",
							)}
						>
							{item.icon && (
								<span className="text-muted-foreground flex h-4 w-4 shrink-0 items-center justify-center">
									{resolveIconElement(item.icon, { className: "h-4 w-4" })}
								</span>
							)}
							<div className="flex min-w-0 flex-col items-start">
								{item.highlights?.title ? (
									<span className="truncate">
										{highlightText(item.label, query)}
									</span>
								) : (
									<span className="truncate">{resolveText(item.label)}</span>
								)}
								{item.sublabel && (
									<span className="text-muted-foreground truncate text-xs">
										{item.sublabel}
									</span>
								)}
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
});

// ============================================================================
// Main Component
// ============================================================================

export function GlobalSearch({
	isOpen,
	onClose,
	navigate,
	basePath: basePathProp,
}: GlobalSearchProps) {
	const { t } = useTranslation();
	const resolveText = useResolveText();

	// Get admin config from server
	const { data: serverConfig } = useAdminConfig();
	const storeBasePath = useAdminStore(selectBasePath);
	const basePath = basePathProp ?? storeBasePath ?? "/admin";

	// Search state
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Debounce query for record search (300ms)
	const debouncedQuery = useDebouncedValue(query, 300);

	// Fetch records from search API
	const { data: searchResults, isLoading: isSearching } = useGlobalSearch({
		query: debouncedQuery,
		limit: 10,
		enabled: debouncedQuery.trim().length >= 2,
	});

	// Build navigation items from server config
	// Note: Server already filters by access rules, we only need to filter by hidden flag
	const navItems = useMemo(() => {
		const items: SearchItem[] = [];
		const collections = serverConfig?.collections ?? {};
		const globals = serverConfig?.globals ?? {};

		// Add visible collections (not hidden in admin)
		for (const [name, config] of Object.entries(collections)) {
			const { label: rawLabel, icon, hidden } = getConfigProps(config);
			// Skip hidden collections
			if (hidden) continue;

			const label = resolveText(rawLabel, name);
			items.push({
				id: `col-${name}`,
				type: "collection",
				label,
				href: `${basePath}/collections/${name}`,
				icon: icon ?? DEFAULT_FOLDER_ICON,
				keywords: [name, "collection", "list"],
			});
		}

		// Add visible globals (not hidden in admin)
		for (const [name, config] of Object.entries(globals)) {
			const { label: rawLabel, icon, hidden } = getConfigProps(config);
			// Skip hidden globals
			if (hidden) continue;

			const label = resolveText(rawLabel, name);
			items.push({
				id: `glob-${name}`,
				type: "global",
				label,
				href: `${basePath}/globals/${name}`,
				icon: icon ?? DEFAULT_GEAR_ICON,
				keywords: [name, "global", "settings", "config"],
			});
		}

		// Add quick actions (create new) only for visible collections
		for (const [name, config] of Object.entries(collections)) {
			const {
				label: rawLabel,
				icon: collectionIcon,
				hidden,
			} = getConfigProps(config);
			// Skip hidden collections
			if (hidden) continue;

			const label = resolveText(rawLabel, name);
			items.push({
				id: `action-create-${name}`,
				type: "action",
				label: t("globalSearch.createNew", { name: label }),
				href: `${basePath}/collections/${name}/create`,
				icon: collectionIcon ?? DEFAULT_PLUS_ICON,
				keywords: ["create", "new", "add", name],
			});
		}

		return items;
	}, [serverConfig, basePath, resolveText, t]);

	// Filter navigation items based on query (client-side)
	const filteredNavItems = useMemo(
		() => filterItems(navItems, query),
		[navItems, query],
	);

	// Convert search results to SearchItem format
	const recordItems = useMemo(() => {
		if (!searchResults?.docs) return [];

		const collections = serverConfig?.collections ?? {};

		return searchResults.docs.map((doc): SearchItem => {
			const collectionName = doc._collection;
			const collectionConfig = collections[collectionName];
			const { label: rawLabel, icon: configIcon } =
				getConfigProps(collectionConfig);
			const collectionLabel = resolveText(rawLabel, collectionName);
			const icon = configIcon ?? DEFAULT_FILE_ICON;

			return {
				id: `record-${collectionName}-${doc.id}`,
				type: "record",
				label: doc._search?.indexedTitle || doc.id,
				sublabel: collectionLabel,
				href: `${basePath}/collections/${collectionName}/${doc.id}`,
				icon,
				highlights: doc._search?.highlights,
			};
		});
	}, [searchResults, serverConfig, basePath, resolveText]);

	// Group navigation items by type
	const groupedNavItems = useMemo(() => {
		return {
			collections: filteredNavItems.filter((i) => i.type === "collection"),
			globals: filteredNavItems.filter((i) => i.type === "global"),
			actions: filteredNavItems.filter((i) => i.type === "action"),
		};
	}, [filteredNavItems]);

	// Calculate total count and indices
	const allItems = useMemo(() => {
		return [
			...groupedNavItems.collections,
			...groupedNavItems.globals,
			...groupedNavItems.actions,
			...recordItems,
		];
	}, [groupedNavItems, recordItems]);

	const totalCount = allItems.length;
	const collectionsStartIndex = 0;
	const globalsStartIndex = groupedNavItems.collections.length;
	const actionsStartIndex =
		groupedNavItems.collections.length + groupedNavItems.globals.length;
	const recordsStartIndex =
		groupedNavItems.collections.length +
		groupedNavItems.globals.length +
		groupedNavItems.actions.length;

	React.useEffect(() => {
		if (!isOpen) {
			return;
		}

		setQuery("");
		setSelectedIndex(0);

		const timer = setTimeout(() => inputRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, [isOpen]);

	// Handle selection
	const handleSelect = useCallback(
		(item: SearchItem) => {
			navigate(item.href);
			onClose();
		},
		[navigate, onClose],
	);

	// Handle keyboard navigation
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((i) => (totalCount > 0 ? (i + 1) % totalCount : 0));
					break;
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((i) =>
						totalCount > 0 ? (i - 1 + totalCount) % totalCount : 0,
					);
					break;
				case "Enter":
					e.preventDefault();
					if (allItems[selectedIndex]) {
						handleSelect(allItems[selectedIndex]);
					}
					break;
				case "Escape":
					e.preventDefault();
					onClose();
					break;
			}
		},
		[allItems, selectedIndex, totalCount, handleSelect, onClose],
	);

	const handleHover = useCallback((index: number) => {
		setSelectedIndex(index);
	}, []);

	const hasNavResults =
		groupedNavItems.collections.length > 0 ||
		groupedNavItems.globals.length > 0 ||
		groupedNavItems.actions.length > 0;

	const hasRecordResults = recordItems.length > 0;
	const hasResults = hasNavResults || hasRecordResults;

	return (
		<ResponsiveDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
			<ResponsiveDialogContent
				className="qa-global-search gap-0 p-0 sm:max-w-3xl"
				showCloseButton={false}
			>
				{/* Search Input */}
				<div className="qa-global-search__input-area border-border-subtle bg-popover border-b p-3">
					<InputGroup className="h-12 border-transparent bg-transparent focus-within:border-transparent focus-within:ring-0 hover:border-transparent">
						<InputGroupAddon align="inline-start" className="pl-0">
							<Icon icon="ph:magnifying-glass" className="size-5" />
						</InputGroupAddon>
						<InputGroupInput
							ref={inputRef}
							className="h-12 px-0 text-base"
							placeholder={t("globalSearch.placeholder")}
							value={query}
							onChange={(e) => {
								setQuery(e.target.value);
								setSelectedIndex(0);
							}}
							onKeyDown={handleKeyDown}
						/>
						<InputGroupAddon align="inline-end" className="gap-2 pr-0">
							{isSearching && (
								<Icon icon="ph:spinner" className="size-4 animate-spin" />
							)}
							<Kbd>ESC</Kbd>
						</InputGroupAddon>
					</InputGroup>
				</div>

				{/* Results */}
				<div className="qa-global-search__results max-h-[60vh] overflow-y-auto p-2">
					{hasResults ? (
						<>
							{/* Navigation Groups */}
							<SearchGroup
								title={t("globalSearch.collections")}
								items={groupedNavItems.collections}
								selectedIndex={selectedIndex}
								startIndex={collectionsStartIndex}
								onSelect={handleSelect}
								onHover={handleHover}
							/>
							<SearchGroup
								title={t("globalSearch.globals")}
								items={groupedNavItems.globals}
								selectedIndex={selectedIndex}
								startIndex={globalsStartIndex}
								onSelect={handleSelect}
								onHover={handleHover}
							/>
							<SearchGroup
								title={t("globalSearch.quickActions")}
								items={groupedNavItems.actions}
								selectedIndex={selectedIndex}
								startIndex={actionsStartIndex}
								onSelect={handleSelect}
								onHover={handleHover}
							/>

							{/* Record Results */}
							{hasRecordResults && (
								<SearchGroup
									title={t("globalSearch.records")}
									items={recordItems}
									selectedIndex={selectedIndex}
									startIndex={recordsStartIndex}
									onSelect={handleSelect}
									onHover={handleHover}
									query={query}
								/>
							)}
						</>
					) : (
						<div className="text-muted-foreground py-8 text-center text-sm">
							{isSearching ? (
								<div className="flex items-center justify-center gap-2">
									<Icon icon="ph:spinner" className="h-4 w-4 animate-spin" />
									<span>{t("globalSearch.searching")}</span>
								</div>
							) : (
								t("globalSearch.noResults")
							)}
						</div>
					)}
				</div>

				{/* Footer with keyboard hints */}
				<div className="qa-global-search__footer text-muted-foreground flex items-center justify-end gap-4 border-t px-3 py-2 text-xs">
					<span className="flex items-center gap-1">
						<Kbd className="px-1 text-[10px]">↑</Kbd>
						<Kbd className="px-1 text-[10px]">↓</Kbd>
						<span>{t("globalSearch.navigate")}</span>
					</span>
					<span className="flex items-center gap-1">
						<Kbd className="px-1.5 text-[10px]">↵</Kbd>
						<span>{t("globalSearch.select")}</span>
					</span>
				</div>
			</ResponsiveDialogContent>
		</ResponsiveDialog>
	);
}
