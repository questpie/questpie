/**
 * Floating Toolbar
 *
 * Unified floating toolbar that displays when:
 * - Rows are selected in a table view (bulk actions)
 * - Filters are active (filter indicator)
 *
 * Combines both functionalities into a single non-jumping UI element.
 */

"use client";

import { Icon } from "@iconify/react";
import { useQueryClient } from "@tanstack/react-query";
import type { Table } from "@tanstack/react-table";
import * as React from "react";
import type {
  ActionContext,
  ActionDefinition,
  ActionHelpers,
  ActionQueryClient,
} from "../../builder/types/action-types";
import { ConfirmationDialog } from "../../components/actions/confirmation-dialog";
import { resolveIconElement } from "../../components/component-renderer";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { selectAuthClient, useAdminStore } from "../../runtime/provider";

// ============================================================================
// Types
// ============================================================================

export interface BulkActionToolbarProps<TItem = any> {
  /** TanStack Table instance */
  table: Table<TItem>;
  /** Bulk actions to display */
  actions: ActionDefinition<TItem>[];
  /** Collection name */
  collection: string;
  /** Action helpers */
  helpers: ActionHelpers;
  /** Total count of items matching current filter (for "select all matching") */
  totalCount?: number;
  /** Number of items on current page */
  pageCount?: number;
  /** Callback when action dialog should open */
  onOpenDialog?: (action: ActionDefinition<TItem>, items: TItem[]) => void;
  /** Callback to select all items matching current filter */
  onSelectAllMatching?: () => Promise<void>;
  /** Callback to execute bulk delete */
  onBulkDelete?: (ids: string[]) => Promise<void>;
  /** Number of active filters (for filter indicator segment) */
  filterCount?: number;
  /** Callback to clear all filters */
  onClearFilters?: () => void;
  /** Callback to open filter sheet */
  onOpenFilters?: () => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * BulkActionToolbar - Shows selection count and bulk actions
 *
 * @example
 * ```tsx
 * {selectedItems.length > 0 && (
 *   <BulkActionToolbar
 *     table={table}
 *     actions={bulkActions}
 *     collection="posts"
 *     helpers={actionHelpers}
 *     totalCount={totalItems}
 *     pageCount={items.length}
 *   />
 * )}
 * ```
 */
export function BulkActionToolbar<TItem = any>({
  table,
  actions,
  collection,
  helpers,
  totalCount,
  pageCount,
  onOpenDialog,
  onSelectAllMatching,
  onBulkDelete,
  filterCount = 0,
  onClearFilters,
  onOpenFilters,
}: BulkActionToolbarProps<TItem>): React.ReactElement | null {
  const { t } = useTranslation();
  const resolveText = useResolveText();
  const authClient = useAdminStore(selectAuthClient);
  const queryClient = useQueryClient();
  const [confirmAction, setConfirmAction] =
    React.useState<ActionDefinition<TItem> | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isSelectingAll, setIsSelectingAll] = React.useState(false);

  // Wrapped query client for action context
  const actionQueryClient: ActionQueryClient = React.useMemo(
    () => ({
      invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
      refetchQueries: (filters) => queryClient.refetchQueries(filters),
      resetQueries: (filters) => queryClient.resetQueries(filters),
    }),
    [queryClient],
  );

  // Get selected items
  const selectedRows = table.getSelectedRowModel().rows;
  const selectedItems = React.useMemo(
    () => selectedRows.map((row) => row.original),
    [selectedRows],
  );
  const selectedCount = selectedItems.length;

  // Build action context for bulk operations
  const ctx: ActionContext<TItem[]> = React.useMemo(
    () => ({
      item: selectedItems,
      collection,
      helpers,
      queryClient: actionQueryClient,
      authClient,
    }),
    [selectedItems, collection, helpers, actionQueryClient, authClient],
  );

  // Filter visible actions
  const visibleActions = React.useMemo(() => {
    return actions.filter((action) => {
      if (action.visible === undefined) return true;
      if (typeof action.visible === "function") {
        // For bulk actions, pass the array of items
        return action.visible(ctx as any);
      }
      return action.visible;
    });
  }, [actions, ctx]);

  // Don't render if nothing selected AND no active filters (after all hooks)
  const hasFilters = filterCount > 0;
  const hasSelection = selectedCount > 0;
  if (!hasSelection && !hasFilters) return null;

  // Execute bulk action handler
  const executeBulkAction = async (action: ActionDefinition<TItem>) => {
    const { handler } = action;

    // Handle built-in deleteMany action
    if (action.id === "deleteMany" && onBulkDelete) {
      setIsLoading(true);
      try {
        const ids = selectedItems.map((item: any) => item?.id).filter(Boolean);
        await onBulkDelete(ids);
        table.resetRowSelection();
      } catch (_error) {
        helpers.toast.error(t("collection.bulkDeleteError"));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    switch (handler.type) {
      case "api": {
        setIsLoading(true);
        try {
          // For bulk API calls, would need to send all IDs
          const ids = selectedItems
            .map((item: any) => item?.id)
            .filter(Boolean);
          helpers.toast.info(
            `Bulk API call: ${handler.method || "POST"} ${handler.endpoint} (${ids.length} items)`,
          );
          helpers.refresh();
          table.resetRowSelection();
        } catch (_error) {
          helpers.toast.error(t("collection.bulkActionFailed"));
        } finally {
          setIsLoading(false);
        }
        break;
      }

      case "custom": {
        setIsLoading(true);
        try {
          // Pass all items to the custom handler
          await handler.fn(ctx as any);
          table.resetRowSelection();
        } catch (_error) {
          helpers.toast.error(t("collection.bulkActionFailed"));
        } finally {
          setIsLoading(false);
        }
        break;
      }

      case "dialog":
      case "form": {
        onOpenDialog?.(action, selectedItems);
        break;
      }

      case "navigate": {
        // Navigate doesn't make sense for bulk actions
        helpers.toast.error(
          "Navigate action not supported for bulk operations",
        );
        break;
      }

      case "server": {
        // Server actions with forms open dialog, otherwise execute
        onOpenDialog?.(action, selectedItems);
        break;
      }
    }
  };

  // Handle action click
  const handleActionClick = (action: ActionDefinition<TItem>) => {
    if (action.confirmation) {
      setConfirmAction(action);
    } else {
      executeBulkAction(action);
    }
  };

  // Handle confirmation
  const handleConfirm = async () => {
    if (confirmAction) {
      await executeBulkAction(confirmAction);
      setConfirmAction(null);
    }
  };

  // Handle select all matching
  const handleSelectAllMatching = async () => {
    if (!onSelectAllMatching) return;
    setIsSelectingAll(true);
    try {
      await onSelectAllMatching();
    } finally {
      setIsSelectingAll(false);
    }
  };

  // Check if action is disabled
  const isDisabled = (action: ActionDefinition<TItem>) => {
    if (action.disabled === undefined) return false;
    if (typeof action.disabled === "function") {
      return action.disabled(ctx as any);
    }
    return action.disabled;
  };

  // Group actions: regular and destructive
  const regularActions = visibleActions.filter(
    (a) => a.variant !== "destructive",
  );
  const destructiveActions = visibleActions.filter(
    (a) => a.variant === "destructive",
  );

  return (
    <>
      {/* Fixed toolbar at bottom of screen */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200 max-w-[calc(100%-2rem)] sm:max-w-none">
        <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:py-2.5 bg-background/95 backdrop-blur-md border border-border shadow-lg rounded-full overflow-x-auto">
          {/* Filter segment - shows when filters are active */}
          {hasFilters && (
            <>
              <div className="flex items-center gap-2 shrink-0">
                {onOpenFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onOpenFilters}
                    className="h-6 px-2 text-xs gap-2"
                  >
                    <Icon
                      icon="ph:funnel-fill"
                      width={14}
                      height={14}
                      className="text-primary"
                    />
                    {t("viewOptions.activeFilters", { count: filterCount })}
                  </Button>
                ) : (
                  <>
                    <Icon
                      icon="ph:funnel-fill"
                      width={14}
                      height={14}
                      className="text-primary"
                    />
                    <span className="text-sm font-medium whitespace-nowrap">
                      {t("viewOptions.activeFilters", { count: filterCount })}
                    </span>
                  </>
                )}
                {onClearFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearFilters}
                    className="h-6 px-2 text-xs"
                  >
                    {t("viewOptions.clearFilters")}
                  </Button>
                )}
              </div>

              {/* Divider between filter and selection segments */}
              {hasSelection && <div className="h-4 w-px bg-border shrink-0" />}
            </>
          )}

          {/* Selection segment - shows when rows are selected */}
          {hasSelection && (
            <>
              {/* Selection count */}
              <span className="text-sm font-medium whitespace-nowrap shrink-0">
                {t("collection.selected", { count: selectedCount })}
              </span>

              {/* Divider */}
              <div className="h-4 w-px bg-border shrink-0" />

              {/* Select dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 px-2 shrink-0"
                    />
                  }
                  disabled={isSelectingAll}
                >
                  {t("common.selectAll").split(" ")[0]}
                  <Icon icon="ph:caret-down" className="size-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" sideOffset={8}>
                  <DropdownMenuItem
                    onClick={() => table.toggleAllPageRowsSelected(true)}
                  >
                    {t("collection.selectOnPage")}
                    {pageCount ? ` (${pageCount})` : ""}
                  </DropdownMenuItem>
                  {onSelectAllMatching &&
                    totalCount &&
                    totalCount > (pageCount ?? 0) && (
                      <DropdownMenuItem onClick={handleSelectAllMatching}>
                        {t("collection.selectAllMatching", {
                          count: totalCount,
                        })}
                      </DropdownMenuItem>
                    )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => table.resetRowSelection()}>
                    {t("collection.clearSelection")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Bulk actions dropdown */}
              {visibleActions.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 px-2 shrink-0"
                      />
                    }
                    disabled={isLoading}
                  >
                    {t("common.actions")}
                    <Icon icon="ph:caret-down" className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="center" side="top" sideOffset={8}>
                    {regularActions.map((action) => {
                      const iconElement = resolveIconElement(action.icon, {
                        className: "mr-2 size-4",
                      });
                      return (
                        <DropdownMenuItem
                          key={action.id}
                          onClick={() => handleActionClick(action)}
                          disabled={isDisabled(action) || isLoading}
                        >
                          {iconElement}
                          {resolveText(action.label)}
                        </DropdownMenuItem>
                      );
                    })}

                    {regularActions.length > 0 &&
                      destructiveActions.length > 0 && (
                        <DropdownMenuSeparator />
                      )}

                    {destructiveActions.map((action) => {
                      const iconElement = resolveIconElement(action.icon, {
                        className: "mr-2 size-4",
                      });
                      return (
                        <DropdownMenuItem
                          key={action.id}
                          variant="destructive"
                          onClick={() => handleActionClick(action)}
                          disabled={isDisabled(action) || isLoading}
                        >
                          {iconElement}
                          {resolveText(action.label)}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* Clear selection button */}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => table.resetRowSelection()}
                className="size-7 shrink-0"
              >
                <Icon icon="ph:x" className="size-4" />
                <span className="sr-only">
                  {t("collection.clearSelection")}
                </span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Confirmation dialog */}
      {confirmAction?.confirmation && (
        <ConfirmationDialog
          open={!!confirmAction}
          onOpenChange={(open) => !open && setConfirmAction(null)}
          config={{
            ...confirmAction.confirmation,
            // Override description to include count
            description: confirmAction.confirmation.description
              ? `${confirmAction.confirmation.description} (${selectedCount} items)`
              : `This will affect ${selectedCount} items.`,
          }}
          onConfirm={handleConfirm}
          loading={isLoading}
        />
      )}
    </>
  );
}
