/**
 * Header Actions
 *
 * Renders action buttons for the collection header area.
 * Primary actions are shown as buttons, secondary in a dropdown menu.
 */

"use client";

import { Icon } from "@iconify/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import type {
  ActionContext,
  ActionDefinition,
  ActionHelpers,
  ActionQueryClient,
  HeaderActionsConfig,
} from "../../builder/types/action-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useResolveText } from "../../i18n/hooks";
import { selectAuthClient, useAdminStore } from "../../runtime/provider";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { ActionButton } from "./action-button";

export interface HeaderActionsProps<TItem = any> {
  /** Header actions config with primary/secondary */
  actions: HeaderActionsConfig<TItem>;
  /** Collection name */
  collection: string;
  /** Action helpers */
  helpers: ActionHelpers;
  /** Callback when action dialog should open */
  onOpenDialog?: (action: ActionDefinition<TItem>) => void;
}

/**
 * HeaderActions - Renders action buttons in the header area
 *
 * Primary actions are shown as buttons.
 * Secondary actions are shown in a dropdown menu.
 *
 * @example
 * ```tsx
 * <HeaderActions
 *   actions={{
 *     primary: [createAction],
 *     secondary: [exportAction, importAction],
 *   }}
 *   collection="posts"
 *   helpers={actionHelpers}
 *   onOpenDialog={(action) => setDialogAction(action)}
 * />
 * ```
 */
export function HeaderActions<TItem = any>({
  actions,
  collection,
  helpers,
  onOpenDialog,
}: HeaderActionsProps<TItem>): React.ReactElement | null {
  const resolveText = useResolveText();
  const authClient = useAdminStore(selectAuthClient);
  const queryClient = useQueryClient();

  // Wrapped query client for action context
  const actionQueryClient: ActionQueryClient = React.useMemo(
    () => ({
      invalidateQueries: (filters) => queryClient.invalidateQueries(filters),
      refetchQueries: (filters) => queryClient.refetchQueries(filters),
      resetQueries: (filters) => queryClient.resetQueries(filters),
    }),
    [queryClient],
  );

  // Build action context for visibility checks
  const ctx: ActionContext<TItem> = React.useMemo(
    () => ({
      collection,
      helpers,
      queryClient: actionQueryClient,
      authClient,
    }),
    [collection, helpers, actionQueryClient, authClient],
  );

  // Filter visible actions
  const filterVisible = React.useCallback(
    (actionList: ActionDefinition<TItem>[] | undefined) => {
      if (!actionList) return [];
      return actionList.filter((action) => {
        if (action.visible === undefined) return true;
        if (typeof action.visible === "function") {
          return action.visible(ctx);
        }
        return action.visible;
      });
    },
    [ctx],
  );

  const visiblePrimary = React.useMemo(
    () => filterVisible(actions.primary),
    [actions.primary, filterVisible],
  );

  const visibleSecondary = React.useMemo(
    () => filterVisible(actions.secondary),
    [actions.secondary, filterVisible],
  );

  // Group secondary actions by variant (destructive at the end)
  const regularSecondary = visibleSecondary.filter(
    (a) => a.variant !== "destructive",
  );
  const destructiveSecondary = visibleSecondary.filter(
    (a) => a.variant === "destructive",
  );

  if (visiblePrimary.length === 0 && visibleSecondary.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      {/* Primary actions as buttons */}
      {visiblePrimary.map((action) => (
        <ActionButton
          key={action.id}
          action={action}
          collection={collection}
          helpers={helpers}
          onOpenDialog={onOpenDialog}
        />
      ))}

      {/* Secondary actions in dropdown */}
      {visibleSecondary.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" className="size-9" />}
          >
            <Icon icon="ph:dots-three-vertical" className="size-4" />
            <span className="sr-only">More actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {regularSecondary.map((action) => {
              const iconElement = resolveIconElement(action.icon, {
                className: "mr-2 size-4",
              });
              return (
                <DropdownMenuItem
                  key={action.id}
                  onClick={() => onOpenDialog?.(action)}
                >
                  {iconElement}
                  {resolveText(action.label)}
                </DropdownMenuItem>
              );
            })}

            {regularSecondary.length > 0 && destructiveSecondary.length > 0 && (
              <DropdownMenuSeparator />
            )}

            {destructiveSecondary.map((action) => {
              const iconElement = resolveIconElement(action.icon, {
                className: "mr-2 size-4",
              });
              return (
                <DropdownMenuItem
                  key={action.id}
                  variant="destructive"
                  onClick={() => onOpenDialog?.(action)}
                >
                  {iconElement}
                  {resolveText(action.label)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
