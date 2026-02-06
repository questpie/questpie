/**
 * Action Execution Functions
 *
 * Server-side functions for executing collection actions.
 * Actions can be built-in (create, delete, etc.) or custom with forms.
 *
 * @example
 * ```ts
 * // Execute a custom action
 * const result = await executeAction(app, {
 *   collection: "posts",
 *   actionId: "publish",
 *   itemId: "123",
 *   data: {},
 * });
 * ```
 */

import { fn, type Questpie } from "questpie";
import { z } from "zod";
import type {
  ServerActionContext,
  ServerActionDefinition,
  ServerActionFormField,
  ServerActionResult,
  ServerActionsConfig,
} from "../../../augmentation.js";

// Type alias for the CMS app
type App = Questpie<any>;

/**
 * Request to execute an action
 */
export interface ExecuteActionRequest {
  /** Collection slug */
  collection: string;
  /** Action ID (builtin: "create", "delete", etc. or custom id) */
  actionId: string;
  /** Single item ID (for single-item actions) */
  itemId?: string;
  /** Multiple item IDs (for bulk actions) */
  itemIds?: string[];
  /** Form data (for actions with forms) */
  data?: Record<string, unknown>;
  /** Current locale */
  locale?: string;
}

/**
 * Response from action execution
 */
export interface ExecuteActionResponse {
  success: boolean;
  result?: ServerActionResult;
  error?: string;
}

/**
 * Get action configuration for introspection.
 * Returns action definitions without handlers (for client-side rendering).
 */
export function getActionsConfig(
  app: App,
  collectionSlug: string,
): {
  builtin: string[];
  custom: Array<Omit<ServerActionDefinition, "handler">>;
} | null {
  const state = (app as any).state as any;
  const collection = state.collections?.[collectionSlug];

  if (!collection) {
    return null;
  }

  const collectionState = collection.state || collection;
  const actionsConfig: ServerActionsConfig | undefined =
    collectionState.adminActions;

  if (!actionsConfig) {
    // Return default built-in actions if no config
    return {
      builtin: ["create", "save", "delete", "deleteMany"],
      custom: [],
    };
  }

  // Strip handlers from custom actions for client
  const customWithoutHandlers = (actionsConfig.custom || []).map((action) => {
    const { handler, ...rest } = action;
    return rest;
  });

  return {
    builtin: actionsConfig.builtin || [
      "create",
      "save",
      "delete",
      "deleteMany",
    ],
    custom: customWithoutHandlers,
  };
}

/**
 * Execute a collection action.
 * Handles both built-in actions and custom actions.
 */
export async function executeAction(
  app: App,
  request: ExecuteActionRequest,
  session?: unknown,
): Promise<ExecuteActionResponse> {
  const {
    collection: collectionSlug,
    actionId,
    itemId,
    itemIds,
    data,
    locale,
  } = request;

  const state = (app as any).state as any;
  const collection = state.collections?.[collectionSlug];

  if (!collection) {
    return {
      success: false,
      error: `Collection "${collectionSlug}" not found`,
    };
  }

  const collectionState = collection.state || collection;
  const actionsConfig: ServerActionsConfig | undefined =
    collectionState.adminActions;

  // Handle built-in actions
  const builtinActions = actionsConfig?.builtin || [
    "create",
    "save",
    "delete",
    "deleteMany",
    "duplicate",
  ];

  if (builtinActions.includes(actionId as any)) {
    return executeBuiltinAction(app, {
      collectionSlug,
      actionId,
      itemId,
      itemIds,
      data,
      locale,
      session,
    });
  }

  // Find custom action
  const customAction = actionsConfig?.custom?.find((a) => a.id === actionId);

  if (!customAction) {
    return {
      success: false,
      error: `Action "${actionId}" not found on collection "${collectionSlug}"`,
    };
  }

  // Validate form data if action has a form
  if (customAction.form) {
    const validationError = validateActionFormData(
      customAction.form.fields,
      data || {},
    );
    if (validationError) {
      return {
        success: false,
        result: {
          type: "error",
          toast: { message: validationError },
        },
      };
    }
  }

  // Execute custom action handler
  try {
    const context: ServerActionContext = {
      data: data || {},
      itemId,
      itemIds,
      app,
      db: (app as any).db,
      session,
      locale,
    };

    const result = await customAction.handler(context);

    return {
      success: result.type === "success" || result.type === "redirect",
      result,
    };
  } catch (error) {
    console.error(`Action "${actionId}" failed:`, error);
    return {
      success: false,
      result: {
        type: "error",
        toast: {
          message:
            error instanceof Error ? error.message : "Action execution failed",
        },
      },
    };
  }
}

/**
 * Execute a built-in action.
 */
async function executeBuiltinAction(
  app: App,
  params: {
    collectionSlug: string;
    actionId: string;
    itemId?: string;
    itemIds?: string[];
    data?: Record<string, unknown>;
    locale?: string;
    session?: unknown;
  },
): Promise<ExecuteActionResponse> {
  const { collectionSlug, actionId, itemId, itemIds, data } = params;

  try {
    switch (actionId) {
      case "create": {
        const result = await (app as any).create(collectionSlug, data || {});
        return {
          success: true,
          result: {
            type: "success",
            toast: { message: "Item created successfully" },
            effects: {
              invalidate: [collectionSlug],
              redirect: `/admin/collections/${collectionSlug}/${result.id}`,
            },
          },
        };
      }

      case "save": {
        if (!itemId) {
          return {
            success: false,
            result: {
              type: "error",
              toast: { message: "Item ID is required for save action" },
            },
          };
        }
        await (app as any).update(collectionSlug, itemId, data || {});
        return {
          success: true,
          result: {
            type: "success",
            toast: { message: "Item saved successfully" },
            effects: { invalidate: [collectionSlug] },
          },
        };
      }

      case "delete": {
        if (!itemId) {
          return {
            success: false,
            result: {
              type: "error",
              toast: { message: "Item ID is required for delete action" },
            },
          };
        }
        await (app as any).delete(collectionSlug, itemId);
        return {
          success: true,
          result: {
            type: "success",
            toast: { message: "Item deleted successfully" },
            effects: {
              invalidate: [collectionSlug],
              redirect: `/admin/collections/${collectionSlug}`,
            },
          },
        };
      }

      case "deleteMany": {
        if (!itemIds || itemIds.length === 0) {
          return {
            success: false,
            result: {
              type: "error",
              toast: {
                message: "Item IDs are required for bulk delete action",
              },
            },
          };
        }
        // Delete items in parallel
        await Promise.all(
          itemIds.map((id) => (app as any).delete(collectionSlug, id)),
        );
        return {
          success: true,
          result: {
            type: "success",
            toast: { message: `${itemIds.length} items deleted successfully` },
            effects: { invalidate: [collectionSlug] },
          },
        };
      }

      case "duplicate": {
        if (!itemId) {
          return {
            success: false,
            result: {
              type: "error",
              toast: { message: "Item ID is required for duplicate action" },
            },
          };
        }
        const original = await (app as any).findById(collectionSlug, itemId);
        if (!original) {
          return {
            success: false,
            result: {
              type: "error",
              toast: { message: "Item not found" },
            },
          };
        }
        // Remove id and timestamps for duplication
        const { id, createdAt, updatedAt, ...duplicateData } = original;
        const duplicated = await (app as any).create(
          collectionSlug,
          duplicateData,
        );
        return {
          success: true,
          result: {
            type: "success",
            toast: { message: "Item duplicated successfully" },
            effects: {
              invalidate: [collectionSlug],
              redirect: `/admin/collections/${collectionSlug}/${duplicated.id}`,
            },
          },
        };
      }

      default:
        return {
          success: false,
          result: {
            type: "error",
            toast: { message: `Unknown built-in action: ${actionId}` },
          },
        };
    }
  } catch (error) {
    console.error(`Built-in action "${actionId}" failed:`, error);
    return {
      success: false,
      result: {
        type: "error",
        toast: {
          message:
            error instanceof Error ? error.message : "Action execution failed",
        },
      },
    };
  }
}

/**
 * Check if a field is a ServerActionFormFieldDefinition (has getMetadata)
 */
function isFieldDefinition(
  field: ServerActionFormField,
): field is { state: any; getMetadata(): any; toZodSchema(): unknown } {
  return typeof (field as any).getMetadata === "function";
}

/**
 * Extract required status from a form field (handles both config and definition)
 */
function isFieldRequired(field: ServerActionFormField): boolean {
  if (isFieldDefinition(field)) {
    return !!field.state?.required;
  }
  return !!field.required;
}

/**
 * Validate form data against action form fields.
 * Returns error message if validation fails, null if valid.
 */
function validateActionFormData(
  fields: Record<string, ServerActionFormField>,
  data: Record<string, unknown>,
): string | null {
  for (const [fieldName, fieldConfig] of Object.entries(fields)) {
    if (isFieldRequired(fieldConfig) && !data[fieldName]) {
      return `Field "${fieldName}" is required`;
    }
  }
  return null;
}

// ============================================================================
// Schema Definitions
// ============================================================================

const executeActionRequestSchema = z.object({
  collection: z.string(),
  actionId: z.string(),
  itemId: z.string().optional(),
  itemIds: z.array(z.string()).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  locale: z.string().optional(),
});

const executeActionResponseSchema = z.object({
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});

const getActionsConfigRequestSchema = z.object({
  collection: z.string(),
});

const getActionsConfigResponseSchema = z
  .object({
    builtin: z.array(z.string()),
    custom: z.array(z.unknown()),
  })
  .nullable();

// ============================================================================
// CMS Functions
// ============================================================================

/**
 * Execute a collection action.
 *
 * @example
 * ```ts
 * // From client
 * const result = await cms.api.functions.executeAction({
 *   collection: "posts",
 *   actionId: "publish",
 *   itemId: "123",
 * });
 * ```
 */
export const executeActionFn = fn({
  type: "mutation",
  schema: executeActionRequestSchema,
  outputSchema: executeActionResponseSchema,
  handler: async (ctx) => {
    const app = ctx.app as App;
    const session = (ctx as any).session;
    return executeAction(app, ctx.input, session);
  },
});

/**
 * Get actions configuration for a collection.
 * Returns action definitions without handlers for client rendering.
 */
export const getActionsConfigFn = fn({
  type: "query",
  schema: getActionsConfigRequestSchema,
  outputSchema: getActionsConfigResponseSchema,
  handler: (ctx) => {
    const app = ctx.app as App;
    return getActionsConfig(app, ctx.input.collection);
  },
});

/**
 * CMS functions for action execution.
 * These are registered on the adminModule.
 */
export const actionFunctions = {
  executeAction: executeActionFn,
  getActionsConfig: getActionsConfigFn,
};
