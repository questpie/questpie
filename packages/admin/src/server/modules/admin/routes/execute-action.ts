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

import { route } from "questpie";
import { z } from "zod";

import type {
	ServerActionContext,
	ServerActionDefinition,
	ServerActionFormField,
	ServerActionResult,
	ServerActionsConfig,
} from "../../../augmentation.js";
import {
	type App,
	getApp,
	getAppState,
	getDb,
	getSession,
	getLocale,
} from "./route-helpers.js";

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
	const appState = getAppState(app) as Record<string, any>;
	const collection = appState.collections?.[collectionSlug];

	if (!collection) {
		return null;
	}

	const collectionState = collection.state || collection;
	const actionsConfig: ServerActionsConfig | undefined =
		collectionState.adminActions;

	if (!actionsConfig) {
		// Return default built-in actions if no config
		return {
			builtin: [
				"create",
				"save",
				"delete",
				"deleteMany",
				"restore",
				"restoreMany",
				"duplicate",
				"transition",
			],
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
			"restore",
			"restoreMany",
			"duplicate",
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

	const appState = getAppState(app) as Record<string, any>;
	const collection = appState.collections?.[collectionSlug];

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
		"restore",
		"restoreMany",
		"duplicate",
		"transition",
	];

	if ((builtinActions as string[]).includes(actionId)) {
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
		const appRec = app as Record<string, any>;
		const context: ServerActionContext = {
			data: data || {},
			itemId,
			itemIds,
			auth: appRec.auth,
			collections: appRec.api?.collections,
			globals: appRec.api?.globals,
			db: appRec.db,
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
	const appRec = app as Record<string, any>;
	const collectionCrud = appRec.api?.collections?.[collectionSlug];
	const crudContext = {
		db: appRec.db,
		session: params.session,
		locale: params.locale,
	};

	try {
		switch (actionId) {
			case "create": {
				const result = await appRec.create(collectionSlug, data || {});
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
				await appRec.update(collectionSlug, itemId, data || {});
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
				await appRec.delete(collectionSlug, itemId);
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
					itemIds.map((id) => appRec.delete(collectionSlug, id)),
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

			case "restore": {
				if (!itemId) {
					return {
						success: false,
						result: {
							type: "error",
							toast: { message: "Item ID is required for restore action" },
						},
					};
				}

				if (typeof appRec.restore === "function") {
					await appRec.restore(collectionSlug, itemId);
				} else if (collectionCrud?.restoreById) {
					await collectionCrud.restoreById({ id: itemId }, crudContext);
				} else {
					return {
						success: false,
						result: {
							type: "error",
							toast: {
								message: "Restore is not supported for this collection",
							},
						},
					};
				}

				return {
					success: true,
					result: {
						type: "success",
						toast: { message: "Item restored successfully" },
						effects: {
							invalidate: [collectionSlug],
							redirect: `/admin/collections/${collectionSlug}/${itemId}`,
						},
					},
				};
			}

			case "restoreMany": {
				if (!itemIds || itemIds.length === 0) {
					return {
						success: false,
						result: {
							type: "error",
							toast: {
								message: "Item IDs are required for bulk restore action",
							},
						},
					};
				}

				if (typeof appRec.restore === "function") {
					await Promise.all(
						itemIds.map((id) => appRec.restore(collectionSlug, id)),
					);
				} else if (collectionCrud?.restoreById) {
					await Promise.all(
						itemIds.map((id) =>
							collectionCrud.restoreById({ id }, crudContext),
						),
					);
				} else {
					return {
						success: false,
						result: {
							type: "error",
							toast: {
								message: "Restore is not supported for this collection",
							},
						},
					};
				}

				return {
					success: true,
					result: {
						type: "success",
						toast: { message: `${itemIds.length} items restored successfully` },
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
				const original = await appRec.findById(collectionSlug, itemId);
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
				const duplicated = await appRec.create(
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

			case "transition": {
				if (!itemId) {
					return {
						success: false,
						result: {
							type: "error",
							toast: { message: "Item ID is required for transition action" },
						},
					};
				}
				const stage = data?.stage as string | undefined;
				if (!stage) {
					return {
						success: false,
						result: {
							type: "error",
							toast: {
								message: "Target stage is required for transition action",
							},
						},
					};
				}
				if (collectionCrud?.transitionStage) {
					const scheduledAt = data?.scheduledAt as string | undefined;
					const transitionParams: {
						id: string;
						stage: string;
						scheduledAt?: Date;
					} = {
						id: itemId,
						stage,
					};
					if (scheduledAt) {
						transitionParams.scheduledAt = new Date(scheduledAt);
					}
					await collectionCrud.transitionStage(transitionParams, crudContext);
				} else {
					return {
						success: false,
						result: {
							type: "error",
							toast: {
								message:
									"Workflow transitions are not supported for this collection",
							},
						},
					};
				}
				return {
					success: true,
					result: {
						type: "success",
						toast: { message: `Transitioned to "${stage}" successfully` },
						effects: { invalidate: [collectionSlug] },
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
	return typeof (field as unknown as Record<string, unknown>).getMetadata === "function";
}

/**
 * Extract required status from a form field (handles both config and definition)
 */
function isFieldRequired(field: ServerActionFormField): boolean {
	if (isFieldDefinition(field)) {
		return !!((field as unknown as Record<string, any>)._state?.notNull);
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
	result: z.record(z.string(), z.any()).optional(),
	error: z.string().optional(),
});

const getActionsConfigRequestSchema = z.object({
	collection: z.string(),
});

const getActionsConfigResponseSchema = z
	.object({
		builtin: z.array(z.string()),
		custom: z.array(z.record(z.string(), z.any())),
	})
	.nullable();

// ============================================================================
// QUESTPIE Functions
// ============================================================================

/**
 * Execute a collection action.
 *
 * @example
 * ```ts
 * // From client
 * const result = await client.routes.executeAction({
 *   collection: "posts",
 *   actionId: "publish",
 *   itemId: "123",
 * });
 * ```
 */
export const executeActionFn = route()
	.post()
	.schema(executeActionRequestSchema)
	.outputSchema(executeActionResponseSchema)
	.handler(async (ctx) => {
		const app = getApp(ctx);
		const session = getSession(ctx);
		return executeAction(app, ctx.input, session);
	});

/**
 * Get actions configuration for a collection.
 * Returns action definitions without handlers for client rendering.
 */
export const getActionsConfigFn = route()
	.post()
	.schema(getActionsConfigRequestSchema)
	.outputSchema(getActionsConfigResponseSchema)
	.handler((ctx) => {
		const app = getApp(ctx);
		return getActionsConfig(app, ctx.input.collection);
	});

/**
 * QUESTPIE functions for action execution.
 * These are registered on the `adminModule`.
 */
export const actionFunctions = {
	executeAction: executeActionFn,
	getActionsConfig: getActionsConfigFn,
};
