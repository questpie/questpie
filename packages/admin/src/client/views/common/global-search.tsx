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
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { Kbd } from "../../components/ui/kbd";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
} from "../../components/ui/responsive-dialog";
import { useDebouncedValue, useGlobalSearch } from "../../hooks/use-search";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { selectBasePath, useAdminStore } from "../../runtime";
import { useAdminConfig } from "../../hooks/use-admin-config";

// ============================================================================
// Types
// ============================================================================

interface SearchItem {
  id: string;
  type: "collection" | "global" | "action" | "record";
  label: string;
  sublabel?: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  keywords?: string[];
  highlights?: { title?: string };
}

export interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
  navigate: (path: string) => void;
  basePath?: string;
}

// ============================================================================
// Default Icon Components (Iconify wrappers)
// ============================================================================

function FolderIcon({ className }: { className?: string }) {
  return <Icon icon="ph:folder" className={className} />;
}

function GearIcon({ className }: { className?: string }) {
  return <Icon icon="ph:gear" className={className} />;
}

function PlusIcon({ className }: { className?: string }) {
  return <Icon icon="ph:plus" className={className} />;
}

function FileIcon({ className }: { className?: string }) {
  return <Icon icon="ph:file" className={className} />;
}

// ============================================================================
// Helpers
// ============================================================================

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
}

function SearchGroup({
  title,
  items,
  selectedIndex,
  startIndex,
  onSelect,
  onHover,
}: SearchGroupProps) {
  const resolveText = useResolveText();

  if (items.length === 0) return null;

  return (
    <div className="mb-4 last:mb-0">
      <h3 className="mb-2 px-2 font-mono text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground">
        {resolveText(title)}
      </h3>
      <div className="space-y-0.5">
        {items.map((item, idx) => {
          const globalIndex = startIndex + idx;
          const isSelected = globalIndex === selectedIndex;
          const ItemIcon = item.icon;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item)}
              onMouseEnter={() => onHover(globalIndex)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-sm outline-none transition-colors rounded-md",
                isSelected
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50 hover:text-accent-foreground",
              )}
            >
              {ItemIcon && (
                <ItemIcon className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <div className="flex flex-col items-start min-w-0">
                {item.highlights?.title ? (
                  <span
                    className="truncate"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: highlights from server
                    dangerouslySetInnerHTML={{ __html: item.highlights.title }}
                  />
                ) : (
                  <span className="truncate">{resolveText(item.label)}</span>
                )}
                {item.sublabel && (
                  <span className="text-xs text-muted-foreground truncate">
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
}

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
  const navItems = useMemo(() => {
    const items: SearchItem[] = [];
    const collections = serverConfig?.collections ?? {};
    const globals = serverConfig?.globals ?? {};

    // Add collections
    for (const [name, config] of Object.entries(collections)) {
      const label = resolveText((config as any).label, name);
      // Get icon from collection config (getCollections already extracts .state)
      const icon = (config as any)?.icon || FolderIcon;
      items.push({
        id: `col-${name}`,
        type: "collection",
        label,
        href: `${basePath}/collections/${name}`,
        icon,
        keywords: [name, "collection", "list"],
      });
    }

    // Add globals
    for (const [name, config] of Object.entries(globals)) {
      const label = resolveText((config as any).label, name);
      // Get icon from global config (getGlobals already extracts .state)
      const icon = (config as any)?.icon || GearIcon;
      items.push({
        id: `glob-${name}`,
        type: "global",
        label,
        href: `${basePath}/globals/${name}`,
        icon,
        keywords: [name, "global", "settings", "config"],
      });
    }

    // Add quick actions (create new)
    for (const [name, config] of Object.entries(collections)) {
      const label = resolveText((config as any).label, name);
      // Get icon from collection config for the action too
      const collectionIcon = (config as any)?.icon;
      items.push({
        id: `action-create-${name}`,
        type: "action",
        label: t("globalSearch.createNew", { name: label }),
        href: `${basePath}/collections/${name}/create`,
        icon: collectionIcon || PlusIcon,
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
      // Use resolveText for proper localization of collection label
      const collectionLabel = resolveText(
        (collectionConfig as any)?.label,
        collectionName,
      );
      // Get icon from collection config (getCollections already extracts .state)
      const icon = (collectionConfig as any)?.icon || FileIcon;

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

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // Focus input after a small delay to ensure dialog is rendered
      setTimeout(() => inputRef.current?.focus(), 50);
    }
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
          setSelectedIndex((i) => Math.min(i + 1, totalCount - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
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
      <ResponsiveDialogContent className="p-0 gap-0 max-w-2xl">
        {/* Search Input */}
        <div className="flex items-center border-b px-3">
          <Icon
            icon="ph:magnifying-glass"
            className="mr-2 h-5 w-5 text-muted-foreground shrink-0"
          />
          <input
            ref={inputRef}
            className="flex h-14 w-full rounded-none bg-transparent py-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            placeholder={t("globalSearch.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="flex items-center gap-1 shrink-0">
            {isSearching && (
              <Icon
                icon="ph:spinner"
                className="h-4 w-4 animate-spin text-muted-foreground"
              />
            )}
            <Kbd>ESC</Kbd>
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto p-2">
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
                />
              )}
            </>
          ) : (
            <div className="py-8 text-center text-sm text-muted-foreground">
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
        <div className="border-t px-3 py-2 flex items-center justify-end gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd className="text-[10px] px-1">↑</Kbd>
            <Kbd className="text-[10px] px-1">↓</Kbd>
            <span>{t("globalSearch.navigate")}</span>
          </span>
          <span className="flex items-center gap-1">
            <Kbd className="text-[10px] px-1.5">↵</Kbd>
            <span>{t("globalSearch.select")}</span>
          </span>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
