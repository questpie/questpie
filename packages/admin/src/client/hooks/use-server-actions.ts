/**
 * useServerActions Hook
 *
 * Maps server-defined actions (from collection schema) to client ActionDefinitions.
 * Server actions have their handlers stripped during serialization; this hook
 * creates client-side wrappers that execute actions via the server API.
 */

"use client";

import * as React from "react";
import type {
  ActionDefinition,
  ActionsConfig,
} from "../builder/types/action-types";
import type { FieldDefinition } from "../builder/field/field";
import { useCollectionSchema } from "./use-collection-schema";

// ============================================================================
// Server Action Mapping
// ============================================================================

/**
 * Map a server action definition (from collection schema) to a client ActionDefinition
 */
function mapServerAction(
  serverAction: any,
  collection: string,
): ActionDefinition & { scope?: string } {
  const action: ActionDefinition & { scope?: string } = {
    id: serverAction.id,
    label: serverAction.label,
    icon: serverAction.icon,
    variant: serverAction.variant,
    scope: serverAction.scope,
    handler: {
      type: "server" as const,
      actionId: serverAction.id,
      collection,
    },
  };

  // Map confirmation config
  if (serverAction.confirmation) {
    action.confirmation = {
      title:
        typeof serverAction.confirmation.title === "string"
          ? serverAction.confirmation.title
          : "Confirm",
      description:
        typeof serverAction.confirmation.description === "string"
          ? serverAction.confirmation.description
          : undefined,
      confirmLabel:
        typeof serverAction.confirmation.confirmLabel === "string"
          ? serverAction.confirmation.confirmLabel
          : undefined,
      cancelLabel:
        typeof serverAction.confirmation.cancelLabel === "string"
          ? serverAction.confirmation.cancelLabel
          : undefined,
      destructive: serverAction.confirmation.destructive,
    };
  }

  // If server action has a form, create a form handler instead
  if (serverAction.form) {
    const form = serverAction.form;
    // Map server form field configs to FieldDefinitions
    const fields: Record<string, FieldDefinition> = {};
    for (const [fieldName, fieldConfig] of Object.entries(form.fields || {})) {
      const fc = fieldConfig as any;
      fields[fieldName] = {
        state: {
          type: fc.type || "text",
          label: fc.label,
          description: fc.description,
          required: fc.required,
          defaultValue: fc.default,
          options: fc.options,
        },
        getMetadata: () => ({
          type: fc.type || "text",
          label: fc.label,
          description: fc.description,
        }),
      } as unknown as FieldDefinition;
    }

    action.handler = {
      type: "form" as const,
      config: {
        title: form.title,
        description: form.description,
        fields,
        submitLabel: form.submitLabel,
        cancelLabel: form.cancelLabel,
        width: form.width,
        onSubmit: async (_data, _ctx) => {
          // Server form actions are executed via server handler
          // The ActionDialog will handle this
        },
      },
    };
  }

  return action;
}

// ============================================================================
// Hook
// ============================================================================

export interface UseServerActionsOptions {
  /** Collection name */
  collection: string;
}

export interface UseServerActionsReturn {
  /** Server-defined actions mapped to client ActionDefinitions */
  serverActions: ActionDefinition[];
  /** Whether schema is loading */
  isLoading: boolean;
}

/**
 * Hook to fetch and map server-defined actions for a collection.
 * Reads actions from the collection schema endpoint (admin.actions).
 *
 * @example
 * ```tsx
 * const { serverActions } = useServerActions({ collection: "posts" });
 * // Merge with local actions in useActions hook
 * ```
 */
export function useServerActions({
  collection,
}: UseServerActionsOptions): UseServerActionsReturn {
  const { data: schema, isPending } = useCollectionSchema(collection);

  const serverActions = React.useMemo(() => {
    const actionsConfig = schema?.admin?.actions;
    if (!actionsConfig?.custom?.length) return [];

    return actionsConfig.custom.map((serverAction: any) =>
      mapServerAction(serverAction, collection),
    );
  }, [schema?.admin?.actions, collection]);

  return {
    serverActions,
    isLoading: isPending,
  };
}

/**
 * Merge server actions with local actions config.
 * Server actions are added to the appropriate section based on their scope.
 */
export function mergeServerActions<TItem = any>(
  localActions: ActionsConfig<TItem>,
  serverActions: ActionDefinition[],
): ActionsConfig<TItem> {
  if (!serverActions.length) return localActions;

  const headerActions = [...(localActions.header?.primary ?? [])];
  const headerSecondary = [...(localActions.header?.secondary ?? [])];
  const bulkActions = [...(localActions.bulk ?? [])];

  for (const action of serverActions) {
    const scope = (action as any).scope;

    switch (scope) {
      case "bulk":
        bulkActions.push(action as ActionDefinition<TItem>);
        break;
      case "header":
      default:
        // Default: add to header secondary
        headerSecondary.push(action as ActionDefinition<TItem>);
        break;
    }
  }

  return {
    header: {
      primary: headerActions as ActionDefinition<TItem>[],
      secondary: headerSecondary as ActionDefinition<TItem>[],
    },
    bulk: bulkActions,
  };
}
