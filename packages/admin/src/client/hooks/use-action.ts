/**
 * useAction Hook
 *
 * Provides action helpers and state management for collection actions.
 * Handles action execution, navigation, and API calls.
 */

"use client";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";
import { getDefaultActionsConfig } from "../builder/types/action-registry";
import type {
  ActionContext,
  ActionDefinition,
  ActionHelpers,
  ActionQueryClient,
  ActionsConfig,
  HeaderActionsConfig,
} from "../builder/types/action-types";
import { useTranslation } from "../i18n/hooks";
import {
  selectAuthClient,
  selectBasePath,
  selectClient,
  selectContentLocale,
  selectNavigate,
  useAdminStore,
} from "../runtime/provider";

// ============================================================================
// Constants
// ============================================================================

/** Query key prefix for CMS queries (must match use-collection.ts) */
const QUERY_KEY_PREFIX = ["questpie", "collections"] as const;

// ============================================================================
// Types
// ============================================================================

export interface UseActionHelpersOptions {
  /** Collection name */
  collection: string;
  /** Custom refresh callback */
  onRefresh?: () => void;
}

export interface UseActionHelpersReturn {
  /** Action helpers to pass to action components */
  helpers: ActionHelpers;
}

export interface UseActionsOptions<TItem = any> {
  /** Collection name */
  collection: string;
  /** Actions configuration from collection config */
  actionsConfig?: ActionsConfig<TItem>;
  /** Custom refresh callback */
  onRefresh?: () => void;
}

export interface UseActionsReturn<TItem = any> {
  /** Action helpers */
  helpers: ActionHelpers;
  /** Resolved actions config (with defaults) */
  actions: Required<ActionsConfig<TItem>>;
  /** Currently active dialog action */
  dialogAction: ActionDefinition<TItem> | null;
  /** Set active dialog action */
  setDialogAction: (action: ActionDefinition<TItem> | null) => void;
  /** Item for dialog action (for row actions) */
  dialogItem: TItem | null;
  /** Set item for dialog action */
  setDialogItem: (item: TItem | null) => void;
  /** Open dialog for an action */
  openDialog: (action: ActionDefinition<TItem>, item?: TItem) => void;
  /** Close dialog */
  closeDialog: () => void;
}

// ============================================================================
// useActionHelpers Hook
// ============================================================================

/**
 * Hook to create action helpers for a collection
 *
 * @example
 * ```tsx
 * const { helpers } = useActionHelpers({ collection: "posts" });
 *
 * return (
 *   <HeaderActions
 *     actions={headerActions}
 *     collection="posts"
 *     helpers={helpers}
 *   />
 * );
 * ```
 */
export function useActionHelpers({
  collection,
  onRefresh,
}: UseActionHelpersOptions): UseActionHelpersReturn {
  const basePath = useAdminStore(selectBasePath);
  const navigate = useAdminStore(selectNavigate);
  const client = useAdminStore(selectClient);
  const contentLocale = useAdminStore(selectContentLocale);
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  // Create query options proxy for key building (same as use-collection hooks)
  const queryOpts = React.useMemo(
    () =>
      createQuestpieQueryOptions(client as any, {
        keyPrefix: QUERY_KEY_PREFIX,
        locale: contentLocale,
      }),
    [client, contentLocale],
  );

  const helpers: ActionHelpers = React.useMemo(
    () => ({
      navigate,
      toast: {
        success: toast.success,
        error: toast.error,
        info: toast.info,
        warning: toast.warning,
      },
      t,
      invalidateCollection: async (targetCollection?: string) => {
        const col = targetCollection || collection;
        // Invalidate list and count queries for the collection
        await queryClient.invalidateQueries({
          queryKey: queryOpts.key(["collections", col, "find", contentLocale]),
        });
        await queryClient.invalidateQueries({
          queryKey: queryOpts.key(["collections", col, "count", contentLocale]),
        });
        // Call custom refresh handler
        onRefresh?.();
      },
      invalidateItem: async (itemId: string, targetCollection?: string) => {
        const col = targetCollection || collection;
        // Invalidate findOne query for specific item
        await queryClient.invalidateQueries({
          queryKey: queryOpts.key([
            "collections",
            col,
            "findOne",
            contentLocale,
            { id: itemId },
          ]),
        });
        // Also invalidate list queries since item data changed
        await queryClient.invalidateQueries({
          queryKey: queryOpts.key(["collections", col, "find", contentLocale]),
        });
      },
      invalidateAll: async () => {
        // Invalidate all CMS queries
        await queryClient.invalidateQueries({
          queryKey: [...QUERY_KEY_PREFIX],
        });
        // Call custom refresh handler
        onRefresh?.();
      },
      refresh: () => {
        // Invalidate collection queries (better than page reload)
        queryClient.invalidateQueries({
          queryKey: queryOpts.key([
            "collections",
            collection,
            "find",
            contentLocale,
          ]),
        });
        queryClient.invalidateQueries({
          queryKey: queryOpts.key([
            "collections",
            collection,
            "count",
            contentLocale,
          ]),
        });
        // Call custom refresh handler
        onRefresh?.();
      },
      closeDialog: () => {
        // This will be overridden by the component managing dialog state
      },
      basePath,
    }),
    [
      navigate,
      queryClient,
      queryOpts,
      collection,
      contentLocale,
      onRefresh,
      basePath,
      t,
    ],
  );

  return { helpers };
}

// ============================================================================
// useActions Hook
// ============================================================================

/**
 * Hook to manage collection actions with dialog state
 *
 * @example
 * ```tsx
 * const {
 *   helpers,
 *   actions,
 *   dialogAction,
 *   dialogItem,
 *   openDialog,
 *   closeDialog,
 * } = useActions({
 *   collection: "posts",
 *   actionsConfig: config.actions,
 * });
 *
 * return (
 *   <>
 *     <HeaderActions
 *       actions={actions.header}
 *       collection="posts"
 *       helpers={helpers}
 *       onOpenDialog={openDialog}
 *     />
 *
 *     {dialogAction && (
 *       <ActionDialog
 *         open={!!dialogAction}
 *         onOpenChange={(open) => !open && closeDialog()}
 *         action={dialogAction}
 *         collection="posts"
 *         item={dialogItem}
 *         helpers={helpers}
 *       />
 *     )}
 *   </>
 * );
 * ```
 */
export function useActions<TItem = any>({
  collection,
  actionsConfig,
  onRefresh,
}: UseActionsOptions<TItem>): UseActionsReturn<TItem> {
  const [dialogAction, setDialogAction] =
    React.useState<ActionDefinition<TItem> | null>(null);
  const [dialogItem, setDialogItem] = React.useState<TItem | null>(null);

  // Get default actions if not provided
  const defaultActions = React.useMemo(
    () => getDefaultActionsConfig<TItem>(),
    [],
  );

  // Merge provided config with defaults
  const actions: Required<ActionsConfig<TItem>> = React.useMemo(
    () => ({
      header: actionsConfig?.header ??
        defaultActions.header ?? { primary: [], secondary: [] },
      bulk: actionsConfig?.bulk ?? defaultActions.bulk ?? [],
    }),
    [actionsConfig, defaultActions],
  );

  // Close dialog handler
  const closeDialog = React.useCallback(() => {
    setDialogAction(null);
    setDialogItem(null);
  }, []);

  // Get base helpers
  const { helpers: baseHelpers } = useActionHelpers({
    collection,
    onRefresh: () => {
      onRefresh?.();
    },
  });

  // Enhanced helpers with dialog control
  const helpers: ActionHelpers = React.useMemo(
    () => ({
      ...baseHelpers,
      closeDialog,
    }),
    [baseHelpers, closeDialog],
  );

  // Open dialog for an action
  const openDialog = React.useCallback(
    (action: ActionDefinition<TItem>, item?: TItem) => {
      setDialogAction(action);
      setDialogItem(item ?? null);
    },
    [],
  );

  return {
    helpers,
    actions,
    dialogAction,
    setDialogAction,
    dialogItem,
    setDialogItem,
    openDialog,
    closeDialog,
  };
}

// ============================================================================
// useActionExecution Hook
// ============================================================================

export interface UseActionExecutionOptions<TItem = any> {
  /** Collection name */
  collection: string;
  /** Action helpers */
  helpers: ActionHelpers;
}

/**
 * Hook for executing individual actions
 *
 * Provides a function to execute an action with proper error handling
 * and loading state management.
 */
export function useActionExecution<TItem = any>({
  collection,
  helpers,
}: UseActionExecutionOptions<TItem>) {
  const client = useAdminStore(selectClient);
  const authClient = useAdminStore(selectAuthClient);
  const queryClient = useQueryClient();
  const [isExecuting, setIsExecuting] = React.useState(false);

  // Wrapped query client for action context
  const actionQueryClient: ActionQueryClient = React.useMemo(
    () => ({
      invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
      refetchQueries: (filters) => queryClient.refetchQueries(filters),
      resetQueries: (filters) => queryClient.resetQueries(filters),
    }),
    [queryClient],
  );

  const executeAction = React.useCallback(
    async (
      action: ActionDefinition<TItem>,
      item?: TItem,
      items?: TItem[],
    ): Promise<void> => {
      const ctx: ActionContext<TItem> = {
        item,
        items,
        collection,
        helpers,
        queryClient: actionQueryClient,
        authClient,
      };

      setIsExecuting(true);
      try {
        const { handler } = action;

        switch (handler.type) {
          case "navigate": {
            const path =
              typeof handler.path === "function"
                ? handler.path(item!)
                : handler.path;
            helpers.navigate(
              `${helpers.basePath}/collections/${collection}/${path}`,
            );
            break;
          }

          case "api": {
            // Replace {id} placeholder in endpoint
            const endpoint = handler.endpoint.replace(
              "{id}",
              String((item as any)?.id || ""),
            );

            // Execute API call
            const method = (handler.method || "POST").toLowerCase();

            // Get collection-specific client
            const collectionClient = (client as any).collections?.[collection];

            if (collectionClient) {
              if (method === "delete" && collectionClient.delete) {
                await collectionClient.delete({ id: (item as any)?.id });
                helpers.toast.success("Item deleted successfully");
              } else {
                // For other methods, show info (actual implementation would call the API)
                helpers.toast.info(`${handler.method || "POST"} ${endpoint}`);
              }
            } else {
              helpers.toast.info(
                `API call: ${handler.method || "POST"} ${endpoint}`,
              );
            }

            helpers.refresh();
            break;
          }

          case "custom": {
            await handler.fn(ctx);
            break;
          }

          case "dialog":
          case "form": {
            // These are handled by the ActionDialog component
            break;
          }

          case "server": {
            // Execute server-side action via API
            const serverHandler = handler as {
              type: "server";
              actionId: string;
              collection: string;
            };
            try {
              const collectionClient = (client as any).collections?.[
                serverHandler.collection
              ];
              if (collectionClient?.executeAction) {
                const result = await collectionClient.executeAction(
                  serverHandler.actionId,
                  {
                    itemId: (item as any)?.id,
                    itemIds: items?.map((i: any) => i?.id).filter(Boolean),
                  },
                );
                if (result?.toast) {
                  if (result.type === "error") {
                    helpers.toast.error(result.toast.message);
                  } else {
                    helpers.toast.success(result.toast.message);
                  }
                }
                if (result?.effects?.invalidate) {
                  if (result.effects.invalidate === true) {
                    await helpers.invalidateAll();
                  } else {
                    for (const col of result.effects.invalidate) {
                      await helpers.invalidateCollection(col);
                    }
                  }
                }
                if (result?.effects?.closeModal) {
                  helpers.closeDialog();
                }
              } else {
                helpers.toast.info(`Server action: ${serverHandler.actionId}`);
              }
            } catch (err) {
              helpers.toast.error(
                err instanceof Error ? err.message : "Server action failed",
              );
            }
            break;
          }
        }
      } catch (error) {
        helpers.toast.error(
          error instanceof Error ? error.message : "Action failed",
        );
      } finally {
        setIsExecuting(false);
      }
    },
    [collection, helpers, client, authClient, actionQueryClient],
  );

  return {
    executeAction,
    isExecuting,
  };
}
