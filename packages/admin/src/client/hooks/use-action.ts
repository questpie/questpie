/**
 * useAction Hook
 *
 * Provides action helpers and state management for collection actions.
 * Handles action execution, navigation, and API calls.
 */

"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { createQuestpieQueryOptions } from "@questpie/tanstack-query";

import { getDefaultActionsConfig } from "../builder/types/action-registry";
import type {
	ActionDefinition,
	ActionHelpers,
	ActionsConfig,
} from "../builder/types/action-types";
import { useTranslation } from "../i18n/hooks";
import {
	selectBasePath,
	selectClient,
	selectContentLocale,
	selectNavigate,
	useAdminStore,
} from "../runtime/provider";

// ============================================================================
// Constants
// ============================================================================

/** Query key prefix for app queries (must match use-collection.ts) */
const QUERY_KEY_PREFIX = ["questpie", "collections"] as const;

// ============================================================================
// Types
// ============================================================================

interface UseActionHelpersOptions {
	/** Collection name */
	collection: string;
	/** Custom refresh callback */
	onRefresh?: () => void;
}

interface UseActionHelpersReturn {
	/** Action helpers to pass to action components */
	helpers: ActionHelpers;
}

interface UseActionsOptions<TItem = any> {
	/** Collection name */
	collection: string;
	/** Actions configuration from collection config */
	actionsConfig?: ActionsConfig<TItem>;
	/** Custom refresh callback */
	onRefresh?: () => void;
}

interface UseActionsReturn<TItem = any> {
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
function useActionHelpers({
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
				// Invalidate all queries
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
			header:
				actionsConfig?.header !== undefined
					? actionsConfig.header
					: (defaultActions.header ?? { primary: [], secondary: [] }),
			row: actionsConfig?.row ?? [],
			bulk:
				actionsConfig?.bulk !== undefined
					? actionsConfig.bulk
					: (defaultActions.bulk ?? []),
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
