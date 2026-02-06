/**
 * RelationItemsDisplay Component
 *
 * Unified display component for relation items.
 * Renders items using the specified display mode.
 *
 * Used by:
 * - RelationPicker (editable M:N relations)
 * - ReverseRelationField (read-only reverse relations)
 */

import type * as React from "react";
import { useResolveText } from "../../../i18n/hooks";
import type { I18nText } from "../../../i18n/types";
import type {
  CollectionFieldsConfig,
  RelationDisplayFields,
  RelationDisplayMode,
  RelationDisplayProps,
  RelationItemActions,
} from "./displays";
import { CardsDisplay } from "./displays/cards-display";
import { ChipsDisplay } from "./displays/chips-display";
import { GridDisplay } from "./displays/grid-display";
import { ListDisplay } from "./displays/list-display";
import { TableDisplay } from "./displays/table-display";

export interface RelationItemsDisplayProps {
  /**
   * Display mode
   */
  display?: RelationDisplayMode;

  /**
   * Items to display
   */
  items: any[];

  /**
   * Collection name
   */
  collection: string;

  /**
   * Collection icon component
   */
  collectionIcon?: React.ComponentType<{ className?: string }>;

  /**
   * Action handlers
   */
  actions?: RelationItemActions;

  /**
   * Whether items are editable (shows edit/remove buttons inline)
   */
  editable?: boolean;

  /**
   * Whether items can be reordered (shows drag handle)
   */
  orderable?: boolean;

  /**
   * Columns for table display
   */
  columns?: string[];

  /**
   * Field mapping for cards/grid display
   */
  fields?: RelationDisplayFields;

  /**
   * Number of columns for grid/cards layout
   */
  gridColumns?: 1 | 2 | 3 | 4;

  /**
   * Show link to detail page (for read-only displays)
   */
  linkToDetail?: boolean;

  /**
   * Custom render function for list items
   */
  renderItem?: (item: any, index: number) => React.ReactNode;

  /**
   * Message to show when no items
   */
  emptyMessage?: I18nText;

  /**
   * Collection config for cell rendering (enables proper cell components in table mode)
   */
  collectionConfig?: CollectionFieldsConfig;
}

export function RelationItemsDisplay({
  display = "list",
  items,
  collection,
  collectionIcon,
  actions,
  editable = false,
  orderable = false,
  columns,
  fields,
  gridColumns,
  linkToDetail = false,
  renderItem,
  emptyMessage = "No items",
  collectionConfig,
}: RelationItemsDisplayProps) {
  const resolveText = useResolveText();
  const resolvedEmptyMessage = resolveText(emptyMessage ?? "No items");
  // Empty state
  if (!items || items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">{resolvedEmptyMessage}</p>
      </div>
    );
  }

  const displayProps: RelationDisplayProps = {
    items,
    collection,
    collectionIcon,
    actions,
    editable,
    orderable,
    columns: columns || ["_title"],
    fields,
    gridColumns,
    linkToDetail,
    renderItem,
    collectionConfig,
  };

  switch (display) {
    case "chips":
      return <ChipsDisplay {...displayProps} />;
    case "table":
      return <TableDisplay {...displayProps} />;
    case "cards":
      return <CardsDisplay {...displayProps} />;
    case "grid":
      return <GridDisplay {...displayProps} />;
    case "list":
    default:
      return <ListDisplay {...displayProps} />;
  }
}

// Re-export types for convenience
export type {
  CollectionFieldsConfig,
  RelationDisplayFields,
  RelationDisplayMode,
  RelationDisplayProps,
  RelationItemActions,
} from "./displays";
