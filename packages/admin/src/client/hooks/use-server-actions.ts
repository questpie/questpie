/**
 * useServerActions Hook
 *
 * Maps server-defined actions (from collection schema) to client ActionDefinitions.
 * Server actions have their handlers stripped during serialization; this hook
 * creates client-side wrappers that execute actions via the server API.
 */

"use client";

import * as React from "react";
import type { FieldDefinition } from "../builder/field/field";
import type {
	ActionContext,
	ActionDefinition,
	ActionsConfig,
} from "../builder/types/action-types";
import { selectAdmin, selectClient, useAdminStore } from "../runtime";
import { useCollectionSchema } from "./use-collection-schema";

type ServerExecuteActionResponse = {
	success: boolean;
	result?: {
		type?: "success" | "error" | "redirect" | "download";
		toast?: { message?: string };
		effects?: {
			invalidate?: boolean | string[];
			redirect?: string;
			closeModal?: boolean;
		};
		url?: string;
	};
	error?: string;
};

function getActionErrorMessage(response: ServerExecuteActionResponse): string {
	if (response.error) return response.error;
	if (response.result?.toast?.message) return response.result.toast.message;
	return "Action execution failed";
}

async function applyServerActionEffects(
	result: ServerExecuteActionResponse["result"],
	ctx: ActionContext,
): Promise<void> {
	if (!result) return;

	if (result.effects?.invalidate === true) {
		await ctx.helpers.invalidateAll();
	} else if (Array.isArray(result.effects?.invalidate)) {
		for (const col of result.effects.invalidate) {
			await ctx.helpers.invalidateCollection(col);
		}
	}

	if (result.effects?.redirect) {
		ctx.helpers.navigate(result.effects.redirect);
	}

	if (result.type === "redirect" && result.url) {
		ctx.helpers.navigate(result.url);
	}
}

function buildServerFormFields(
	rawFields: Record<string, any> | undefined,
	fieldRegistry: Record<string, any> | null,
): Record<string, FieldDefinition> {
	if (!rawFields || !fieldRegistry) return {};

	const result: Record<string, FieldDefinition> = {};

	for (const [fieldName, fieldConfig] of Object.entries(rawFields)) {
		const fc = fieldConfig as {
			type?: string;
			label?: unknown;
			description?: unknown;
			required?: boolean;
			default?: unknown;
			options?: unknown;
		};

		if (
			fieldConfig &&
			typeof fieldConfig === "object" &&
			"name" in (fieldConfig as Record<string, unknown>) &&
			"field" in (fieldConfig as Record<string, unknown>) &&
			"~options" in (fieldConfig as Record<string, unknown>)
		) {
			result[fieldName] = fieldConfig as FieldDefinition;
			continue;
		}

		const requestedType =
			typeof fc.type === "string" && fc.type.length > 0 ? fc.type : "text";
		const fieldBuilder =
			fieldRegistry[requestedType] ?? fieldRegistry.text ?? null;

		if (!fieldBuilder || typeof fieldBuilder.$options !== "function") {
			continue;
		}

		const options: Record<string, unknown> = {
			label: fc.label,
			description: fc.description,
			required: fc.required,
			defaultValue: fc.default,
		};

		if (fc.options && typeof fc.options === "object") {
			Object.assign(options, fc.options as Record<string, unknown>);
		}

		result[fieldName] = fieldBuilder.$options(options) as FieldDefinition;
	}

	return result;
}

// ============================================================================
// Server Action Mapping
// ============================================================================

/**
 * Map a server action definition (from collection schema) to a client ActionDefinition
 */
function mapServerAction(
	serverAction: any,
	collection: string,
	fieldRegistry: Record<string, any> | null,
	client: any,
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
			title: serverAction.confirmation.title ?? "Confirm",
			description: serverAction.confirmation.description,
			confirmLabel: serverAction.confirmation.confirmLabel,
			cancelLabel: serverAction.confirmation.cancelLabel,
			destructive: serverAction.confirmation.destructive,
		};
	}

	// If server action has a form, create a form handler instead
	if (serverAction.form) {
		const form = serverAction.form;
		const fields = buildServerFormFields(form.fields, fieldRegistry);

		action.handler = {
			type: "form" as const,
			config: {
				title: form.title,
				description: form.description,
				fields,
				submitLabel: form.submitLabel,
				cancelLabel: form.cancelLabel,
				width: form.width,
				onSubmit: async (data, ctx) => {
					const rpc = client?.rpc;
					if (!rpc?.executeAction) {
						throw new Error("executeAction RPC is not available");
					}

					const itemId =
						ctx.item && !Array.isArray(ctx.item)
							? ((ctx.item as Record<string, unknown>).id as string | undefined)
							: undefined;

					const idsFromItems = Array.isArray(ctx.items)
						? ctx.items.map((it: any) => it?.id).filter(Boolean)
						: [];
					const idsFromItemArray = Array.isArray(ctx.item)
						? (ctx.item as any[]).map((it: any) => it?.id).filter(Boolean)
						: [];

					const itemIds =
						idsFromItems.length > 0
							? idsFromItems
							: idsFromItemArray.length > 0
								? idsFromItemArray
								: undefined;

					const response = (await rpc.executeAction({
						collection,
						actionId: serverAction.id,
						itemId,
						itemIds,
						data,
					})) as ServerExecuteActionResponse;

					if (!response.success || response.result?.type === "error") {
						throw new Error(getActionErrorMessage(response));
					}

					await applyServerActionEffects(response.result, ctx);
				},
			},
		};
	}

	return action;
}

// ============================================================================
// Hook
// ============================================================================

interface UseServerActionsOptions {
	/** Collection name */
	collection: string;
}

interface UseServerActionsReturn {
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
	const admin = useAdminStore(selectAdmin);
	const client = useAdminStore(selectClient);
	const { data: schema, isPending } = useCollectionSchema(collection);

	const serverActions = React.useMemo(() => {
		const actionsConfig = schema?.admin?.actions;
		if (!actionsConfig?.custom?.length) return [];

		const fieldRegistry = (admin?.getFields?.() as Record<string, any>) ?? null;

		return actionsConfig.custom.map((serverAction: any) =>
			mapServerAction(serverAction, collection, fieldRegistry, client),
		);
	}, [schema?.admin?.actions, collection, admin, client]);

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
				headerActions.push(action as ActionDefinition<TItem>);
				break;
			default:
				// single/row actions are resolved in form view
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
