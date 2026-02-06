/**
 * Action Types
 *
 * Type definitions for collection actions (header, bulk).
 * - header: Actions in list view header (create, import, etc.)
 * - bulk: Actions in selection toolbar (deleteMany, duplicate for single item)
 *
 * Actions can have different handler types: navigate, dialog, form, api, custom.
 */

import type * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import type { I18nText } from "../../i18n/types";
import type { FieldDefinition } from "../field/field";
import type { IconComponent, MaybeLazyComponent } from "./common";

// ============================================================================
// Action Context
// ============================================================================

/**
 * Action helpers provided to action handlers
 */
export interface ActionHelpers {
  /** Navigate to a path */
  navigate: (path: string) => void;
  /** Show toast notification */
  toast: {
    success: (message: string) => void;
    error: (message: string) => void;
    info: (message: string) => void;
    warning: (message: string) => void;
  };
  /**
   * Translate a message key
   * @param key - Translation key
   * @param params - Interpolation parameters
   */
  t: (key: string, params?: Record<string, unknown>) => string;
  /**
   * Invalidate collection queries (triggers refetch)
   * @param collection - Collection name (defaults to current collection)
   */
  invalidateCollection: (collection?: string) => Promise<void>;
  /**
   * Invalidate a specific item query
   * @param id - Item ID
   * @param collection - Collection name (defaults to current collection)
   */
  invalidateItem: (id: string, collection?: string) => Promise<void>;
  /**
   * Invalidate all CMS queries
   */
  invalidateAll: () => Promise<void>;
  /**
   * Refresh the current view/data (alias for invalidateCollection)
   * @deprecated Use invalidateCollection() instead for clarity
   */
  refresh: () => void;
  /** Close the current dialog */
  closeDialog: () => void;
  /** Base path for admin routes */
  basePath: string;
}

/**
 * Query client interface for advanced query operations
 */
export interface ActionQueryClient {
  /** Invalidate queries matching the filter */
  invalidateQueries: (filters: {
    queryKey?: readonly unknown[];
  }) => Promise<void>;
  /** Refetch queries matching the filter */
  refetchQueries: (filters: { queryKey?: readonly unknown[] }) => Promise<void>;
  /** Reset queries matching the filter */
  resetQueries: (filters: { queryKey?: readonly unknown[] }) => Promise<void>;
}

/**
 * Context provided to action handlers and callbacks
 */
export interface ActionContext<TItem = any> {
  /** Item(s) being acted upon - single item for form actions, array for bulk */
  item?: TItem;
  /** Multiple items (for bulk actions) */
  items?: TItem[];
  /** Collection name */
  collection: string;
  /** Action helpers */
  helpers: ActionHelpers;
  /** Query client for advanced cache operations */
  queryClient: ActionQueryClient;
  /** Auth client for authentication operations (signUp, signIn, etc.) */
  authClient?: any | null;
}

// ============================================================================
// Action Handler Types
// ============================================================================

/**
 * Navigate handler - navigates to a path
 */
export interface NavigateHandler<TItem = any> {
  type: "navigate";
  /** Path to navigate to (can be a function for dynamic paths) */
  path: string | ((item: TItem) => string);
}

/**
 * Props for dialog components
 */
export interface ActionDialogProps<TItem = any> {
  /** Item being acted upon */
  item?: TItem;
  /** Multiple items for bulk actions */
  items?: TItem[];
  /** Collection name */
  collection: string;
  /** Close the dialog */
  onClose: () => void;
  /** Success callback */
  onSuccess?: () => void;
}

/**
 * Dialog handler - opens a dialog component
 */
export interface DialogHandler<TItem = any> {
  type: "dialog";
  /** Component to render in the dialog */
  component: MaybeLazyComponent<ActionDialogProps<TItem>>;
}

/**
 * Form handler configuration
 *
 * Uses FieldDefinition from the admin builder for full field system support.
 * Fields are validated automatically using buildValidationSchema.
 */
export interface ActionFormConfig<TItem = any> {
  /** Dialog title */
  title: I18nText;
  /** Dialog description */
  description?: I18nText;
  /** Form fields using FieldDefinition */
  fields: Record<string, FieldDefinition>;
  /** Default values */
  defaultValues?: Record<string, any>;
  /** Submit handler */
  onSubmit: (
    data: Record<string, any>,
    ctx: ActionContext<TItem>,
  ) => void | Promise<void>;
  /** Submit button label */
  submitLabel?: I18nText;
  /** Cancel button label */
  cancelLabel?: I18nText;
  /** Dialog width */
  width?: "sm" | "md" | "lg" | "xl";
}

/**
 * Form handler - opens a form dialog
 */
export interface FormHandler<TItem = any> {
  type: "form";
  /** Form configuration */
  config: ActionFormConfig<TItem>;
}

/**
 * API handler - calls an API endpoint
 */
export interface ApiHandler {
  type: "api";
  /** Endpoint path (can include {id} placeholder) */
  endpoint: string;
  /** HTTP method */
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Request body factory */
  body?: (ctx: ActionContext) => Record<string, any>;
}

/**
 * Custom handler - runs arbitrary code
 */
export interface CustomHandler<TItem = any> {
  type: "custom";
  /** Handler function */
  fn: (ctx: ActionContext<TItem>) => void | Promise<void>;
}

/**
 * Server handler - executes action on the server via API.
 * Used for server-defined actions where the handler runs server-side.
 */
export interface ServerHandler {
  type: "server";
  /** Server action ID (matches ServerActionDefinition.id) */
  actionId: string;
  /** Collection name for the action endpoint */
  collection: string;
}

/**
 * Union of all action handler types
 */
export type ActionHandler<TItem = any> =
  | NavigateHandler<TItem>
  | DialogHandler<TItem>
  | FormHandler<TItem>
  | ApiHandler
  | CustomHandler<TItem>
  | ServerHandler;

// ============================================================================
// Confirmation
// ============================================================================

/**
 * Confirmation dialog configuration
 */
export interface ConfirmationConfig {
  /** Dialog title */
  title: string;
  /** Dialog description */
  description?: string;
  /** Confirm button label */
  confirmLabel?: string;
  /** Cancel button label */
  cancelLabel?: string;
  /** Use destructive styling */
  destructive?: boolean;
}

// ============================================================================
// Action Definition
// ============================================================================

/**
 * Button variant types (matching shadcn button variants)
 */
export type ActionVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";

/**
 * Complete action definition
 */
export interface ActionDefinition<TItem = any> {
  /** Unique action identifier */
  id: string;
  /** Display label */
  label: I18nText;
  /** Icon component or server-defined component reference */
  icon?: IconComponent | ComponentReference;
  /** Button variant */
  variant?: ActionVariant;
  /** Whether action is visible (static or dynamic) */
  visible?: boolean | ((ctx: ActionContext<TItem>) => boolean);
  /** Whether action is disabled (static or dynamic) */
  disabled?: boolean | ((ctx: ActionContext<TItem>) => boolean);
  /** Action handler */
  handler: ActionHandler<TItem>;
  /** Confirmation dialog before executing */
  confirmation?: ConfirmationConfig;
}

// ============================================================================
// Actions Config
// ============================================================================

/**
 * Header actions configuration with primary/secondary split
 *
 * @example
 * ```ts
 * header: {
 *   primary: [a.create()],           // Shown as buttons
 *   secondary: [a.action({...})],    // Shown in dropdown menu
 * }
 * ```
 */
export interface HeaderActionsConfig<TItem = any> {
  /** Actions shown as buttons */
  primary?: ActionDefinition<TItem>[];
  /** Actions shown in dropdown menu */
  secondary?: ActionDefinition<TItem>[];
}

/**
 * Collection actions configuration for list views
 */
export interface ActionsConfig<TItem = any> {
  /** Actions displayed in the header area (create, import, etc.) */
  header?: HeaderActionsConfig<TItem>;
  /** Actions for bulk operations on selected items (deleteMany, duplicate, etc.) */
  bulk?: ActionDefinition<TItem>[];
}
