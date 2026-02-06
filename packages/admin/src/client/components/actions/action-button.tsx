/**
 * Action Button
 *
 * A button component that renders an action with optional confirmation dialog.
 * Handles different action types (navigate, api, custom, dialog, form).
 */

"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import type {
  ActionContext,
  ActionDefinition,
  ActionHelpers,
  ActionQueryClient,
} from "../../builder/types/action-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useResolveText } from "../../i18n/hooks";
import { selectAuthClient, useAdminStore } from "../../runtime/provider";
import { Button } from "../ui/button";
import { ConfirmationDialog } from "./confirmation-dialog";

export interface ActionButtonProps<TItem = any> {
  /** Action definition */
  action: ActionDefinition<TItem>;
  /** Collection name */
  collection: string;
  /** Item for row actions */
  item?: TItem;
  /** Items for bulk actions */
  items?: TItem[];
  /** Action helpers */
  helpers: ActionHelpers;
  /** Button size */
  size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-lg" | "xs";
  /** Additional class names */
  className?: string;
  /** Show icon only */
  iconOnly?: boolean;
  /** Callback when action dialog should open */
  onOpenDialog?: (action: ActionDefinition<TItem>) => void;
}

/**
 * ActionButton - Renders an action button with confirmation support
 *
 * @example
 * ```tsx
 * <ActionButton
 *   action={deleteAction}
 *   collection="posts"
 *   item={post}
 *   helpers={actionHelpers}
 * />
 * ```
 */
export function ActionButton<TItem = any>({
  action,
  collection,
  item,
  items,
  helpers,
  size = "default",
  className,
  iconOnly = false,
  onOpenDialog,
}: ActionButtonProps<TItem>): React.ReactElement | null {
  const resolveText = useResolveText();
  const authClient = useAdminStore(selectAuthClient);
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);

  // Wrapped query client for action context
  const actionQueryClient: ActionQueryClient = React.useMemo(
    () => ({
      invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
      refetchQueries: (filters) => queryClient.refetchQueries(filters),
      resetQueries: (filters) => queryClient.resetQueries(filters),
    }),
    [queryClient],
  );

  // Build action context
  const ctx: ActionContext<TItem> = React.useMemo(
    () => ({
      item,
      items,
      collection,
      helpers,
      queryClient: actionQueryClient,
      authClient,
    }),
    [item, items, collection, helpers, actionQueryClient, authClient],
  );

  // Check visibility
  const isVisible = React.useMemo(() => {
    if (action.visible === undefined) return true;
    if (typeof action.visible === "function") {
      return action.visible(ctx);
    }
    return action.visible;
  }, [action.visible, ctx]);

  // Check disabled state
  const isDisabled = React.useMemo(() => {
    if (action.disabled === undefined) return false;
    if (typeof action.disabled === "function") {
      return action.disabled(ctx);
    }
    return action.disabled;
  }, [action.disabled, ctx]);

  if (!isVisible) return null;

  // Handle action execution
  const executeAction = async () => {
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
        setIsLoading(true);
        try {
          // Build endpoint - replace {id} placeholder
          const endpoint = handler.endpoint.replace(
            "{id}",
            String((item as any)?.id || ""),
          );

          // This would need actual API implementation
          // For now, we'll show a placeholder
          helpers.toast.info(
            `API call: ${handler.method || "POST"} ${endpoint}`,
          );
          helpers.refresh();
        } catch (error) {
          helpers.toast.error("Action failed");
        } finally {
          setIsLoading(false);
        }
        break;
      }

      case "custom": {
        setIsLoading(true);
        try {
          await handler.fn(ctx);
        } catch (error) {
          helpers.toast.error("Action failed");
        } finally {
          setIsLoading(false);
        }
        break;
      }

      case "dialog":
      case "form": {
        // Open dialog through parent component
        onOpenDialog?.(action);
        break;
      }

      case "server": {
        // Server actions are handled as form/dialog if they have a form config,
        // otherwise execute directly via the action execution hook
        onOpenDialog?.(action);
        break;
      }
    }
  };

  // Handle button click
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row click propagation

    if (action.confirmation) {
      setShowConfirm(true);
    } else {
      executeAction();
    }
  };

  // Handle confirmation
  const handleConfirm = async () => {
    await executeAction();
  };

  const iconElement = resolveIconElement(action.icon, {
    "data-icon": "inline-start",
  });

  return (
    <>
      <Button
        variant={action.variant || "default"}
        size={iconOnly ? "icon-sm" : size}
        onClick={handleClick}
        disabled={isDisabled || isLoading}
        className={className}
      >
        {iconElement}
        {!iconOnly && resolveText(action.label)}
      </Button>

      {action.confirmation && (
        <ConfirmationDialog
          open={showConfirm}
          onOpenChange={setShowConfirm}
          config={action.confirmation}
          onConfirm={handleConfirm}
          loading={isLoading}
        />
      )}
    </>
  );
}
