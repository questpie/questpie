/**
 * Action Registry
 *
 * Provides built-in action factories and the action registry proxy
 * for type-safe action configuration in collection builders.
 */

import type { ComponentReference } from "#questpie/admin/server";
import { buildPrefillUrl } from "../../hooks/use-prefill-params";
import type { FormViewActionsConfig } from "./field-types";
import type {
  ActionContext,
  ActionDefinition,
  ActionsConfig,
  HeaderActionsConfig,
} from "./action-types";

// ============================================================================
// Action Registry Proxy Type
// ============================================================================

/**
 * Proxy type for building actions with autocomplete
 */
export interface ActionRegistryProxy<TItem = any> {
  /**
   * Create action - navigates to create page (header action)
   */
  create(opts?: Partial<ActionDefinition<TItem>>): ActionDefinition<TItem>;

  /**
   * Duplicate action - creates a copy of the selected item
   * For bulk: shows only when 1 item selected
   * For form: always visible
   */
  duplicate(opts?: Partial<ActionDefinition<TItem>>): ActionDefinition<TItem>;

  /**
   * Delete action - deletes single item with confirmation (form action)
   */
  delete(opts?: Partial<ActionDefinition<TItem>>): ActionDefinition<TItem>;

  /**
   * Delete many action - bulk delete selected items
   */
  deleteMany(opts?: Partial<ActionDefinition<TItem>>): ActionDefinition<TItem>;

  /**
   * Custom action - define a fully custom action
   */
  action(def: ActionDefinition<TItem>): ActionDefinition<TItem>;
}

// ============================================================================
// Built-in Action Factories
// ============================================================================

/**
 * Create a "Create" action
 */
function createCreateAction<TItem>(
  opts?: Partial<ActionDefinition<TItem>>,
): ActionDefinition<TItem> {
  return {
    id: "create",
    label: "Create",
    icon: {
      type: "icon",
      props: { name: "ph:plus" },
    } satisfies ComponentReference,
    variant: "default",
    handler: {
      type: "navigate",
      path: "create",
    },
    ...opts,
  };
}

/**
 * Create a "Duplicate" action (bulk action, shows only when 1 item selected)
 */
function createDuplicateAction<TItem>(
  opts?: Partial<ActionDefinition<TItem>>,
): ActionDefinition<TItem> {
  return {
    id: "duplicate",
    label: "Duplicate",
    icon: {
      type: "icon",
      props: { name: "ph:copy" },
    } satisfies ComponentReference,
    variant: "ghost",
    // Default visibility: only show when exactly 1 item selected
    visible: (ctx) => {
      // For bulk context, ctx.item is an array
      if (Array.isArray(ctx.item)) {
        return ctx.item.length === 1;
      }
      // For form context, ctx.item is a single item
      return !!ctx.item;
    },
    handler: {
      type: "custom",
      fn: async (ctx: ActionContext<TItem>) => {
        // Get the item - either single item or first from array
        const item = Array.isArray(ctx.item) ? ctx.item[0] : ctx.item;
        if (!item) return;

        // Clone the item, removing id and timestamps
        const { id, createdAt, updatedAt, ...data } = item as any;

        // Navigate to create page with prefilled data
        const createPath = `${ctx.helpers.basePath}/collections/${ctx.collection}/create`;
        const prefillUrl = buildPrefillUrl(createPath, data);
        ctx.helpers.navigate(prefillUrl);
      },
    },
    ...opts,
  };
}

/**
 * Create a "Delete Many" (bulk delete) action
 *
 * Note: The actual deletion is handled by BulkActionToolbar via onBulkDelete callback.
 * This action definition just configures the UI and confirmation.
 */
function createDeleteManyAction<TItem>(
  opts?: Partial<ActionDefinition<TItem>>,
): ActionDefinition<TItem> {
  return {
    id: "deleteMany",
    label: "Delete Selected",
    icon: {
      type: "icon",
      props: { name: "ph:trash" },
    } satisfies ComponentReference,
    variant: "destructive",
    confirmation: {
      title: "Delete selected items?",
      description:
        "This action cannot be undone. All selected items will be permanently deleted.",
      confirmLabel: "Delete All",
      destructive: true,
    },
    handler: {
      // Handler is a no-op as deletion is handled by BulkActionToolbar
      // when it detects action.id === "deleteMany" and calls onBulkDelete
      type: "custom",
      fn: async () => {
        // No-op: actual deletion handled by BulkActionToolbar.onBulkDelete
      },
    },
    ...opts,
  };
}

/**
 * Create a "Delete" action for single item (form view)
 */
function createDeleteAction<TItem>(
  opts?: Partial<ActionDefinition<TItem>>,
): ActionDefinition<TItem> {
  return {
    id: "delete",
    label: "Delete",
    icon: {
      type: "icon",
      props: { name: "ph:trash" },
    } satisfies ComponentReference,
    variant: "destructive",
    confirmation: {
      title: "Delete item?",
      description:
        "This action cannot be undone. The item will be permanently deleted.",
      confirmLabel: "Delete",
      destructive: true,
    },
    handler: {
      type: "api",
      endpoint: "{id}",
      method: "DELETE",
    },
    ...opts,
  };
}

// ============================================================================
// Create Action Registry Proxy
// ============================================================================

/**
 * Creates an action registry proxy for type-safe action building
 */
export function createActionRegistryProxy<
  TItem = any,
>(): ActionRegistryProxy<TItem> {
  return {
    create: (opts) => createCreateAction<TItem>(opts),
    duplicate: (opts) => createDuplicateAction<TItem>(opts),
    delete: (opts) => createDeleteAction<TItem>(opts),
    deleteMany: (opts) => createDeleteManyAction<TItem>(opts),
    action: (def) => def,
  };
}

// ============================================================================
// Default Actions
// ============================================================================

/**
 * Get default header actions for a collection
 */
export function getDefaultHeaderActions<
  TItem = any,
>(): HeaderActionsConfig<TItem> {
  return {
    primary: [createCreateAction<TItem>()],
    secondary: [],
  };
}

/**
 * Get default bulk actions for a collection
 */
export function getDefaultBulkActions<
  TItem = any,
>(): ActionDefinition<TItem>[] {
  return [createDeleteManyAction<TItem>(), createDuplicateAction<TItem>()];
}

/**
 * Get default form actions for a collection (edit view)
 */
export function getDefaultFormActions<
  TItem = any,
>(): FormViewActionsConfig<TItem> {
  return {
    primary: [],
    secondary: [createDuplicateAction<TItem>(), createDeleteAction<TItem>()],
  };
}

/**
 * Get complete default actions config
 */
export function getDefaultActionsConfig<TItem = any>(): ActionsConfig<TItem> {
  return {
    header: getDefaultHeaderActions<TItem>(),
    bulk: getDefaultBulkActions<TItem>(),
  };
}
