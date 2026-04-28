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
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import {
	selectAuthClient,
	selectClient,
	useAdminStore,
} from "../../runtime/provider";
import { Button } from "../ui/button";
import { ConfirmationDialog } from "./confirmation-dialog";

interface ActionButtonProps<TItem = any> {
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
	/** Render as a dropdown menu row */
	presentation?: "button" | "menu";
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
	presentation = "button",
	onOpenDialog,
}: ActionButtonProps<TItem>): React.ReactElement | null {
	const resolveText = useResolveText();
	const { t } = useTranslation();
	const authClient = useAdminStore(selectAuthClient);
	const client = useAdminStore(selectClient);
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
	}, [action, ctx]);

	// Check disabled state
	const isDisabled = React.useMemo(() => {
		if (action.disabled === undefined) return false;
		if (typeof action.disabled === "function") {
			return action.disabled(ctx);
		}
		return action.disabled;
	}, [action, ctx]);

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
				// Pre-compute conditional values before try block
				const itemAny = item as any;
				const itemId = itemAny != null ? String(itemAny.id) : "";
				const method = handler.method ? handler.method : "POST";
				const endpoint = handler.endpoint.replace("{id}", itemId);
				try {
					const collectionClient = (client as any).collections?.[collection];
					if (method === "DELETE" && collectionClient?.delete) {
						if (!itemId) throw new Error(t("toast.deleteFailed"));

						await collectionClient.delete({ id: itemId });
						helpers.toast.success(t("toast.deleteSuccess"));
						await helpers.invalidateCollection(collection);
					} else {
						helpers.toast.info(`API call: ${method} ${endpoint}`);
						helpers.refresh();
					}
					setIsLoading(false);
				} catch (error) {
					helpers.toast.error(
						error instanceof Error ? error.message : t("error.actionFailed"),
					);
					setIsLoading(false);
				}
				break;
			}

			case "custom": {
				setIsLoading(true);
				try {
					await handler.fn(ctx);
					setIsLoading(false);
				} catch (error) {
					helpers.toast.error(t("error.actionFailed"));
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
				setIsLoading(true);
				try {
					const routes = (client as any)?.routes;
					if (!routes?.executeAction) {
						throw new Error(t("error.serverActionFailed"));
					}

					const serverHandler = handler as {
						type: "server";
						actionId: string;
						collection: string;
					};
					const itemId =
						item && !Array.isArray(item)
							? String((item as Record<string, unknown>).id ?? "")
							: undefined;
					const itemIds = items
						?.map((it: any) => it?.id)
						.filter(Boolean)
						.map(String);
					const response = await routes.executeAction({
						collection: serverHandler.collection,
						actionId: serverHandler.actionId,
						itemId,
						itemIds: itemIds?.length ? itemIds : undefined,
					});

					if (!response?.success || response.result?.type === "error") {
						const message =
							response?.error ??
							response?.result?.toast?.message ??
							t("error.serverActionFailed");
						throw new Error(message);
					}

					const result = response.result;
					if (result?.toast?.message) {
						helpers.toast.success(result.toast.message);
					} else {
						helpers.toast.success(t("toast.actionSuccess"));
					}

					if (result?.effects?.invalidate === true) {
						await helpers.invalidateAll();
					} else if (Array.isArray(result?.effects?.invalidate)) {
						for (const collectionName of result.effects.invalidate) {
							await helpers.invalidateCollection(collectionName);
						}
					}

					if (result?.effects?.redirect) {
						helpers.navigate(result.effects.redirect);
					}
					if (result?.type === "redirect" && result.url) {
						if (result.external) {
							window.open(result.url, "_blank");
						} else {
							helpers.navigate(result.url);
						}
					}
					if (result?.effects?.closeModal) {
						helpers.closeDialog();
					}
				} catch (error) {
					helpers.toast.error(
						error instanceof Error ? error.message : t("error.actionFailed"),
					);
				} finally {
					setIsLoading(false);
				}
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
	const label = resolveText(action.label);

	return (
		<>
			<Button
				variant={
					presentation === "menu" ? "ghost" : action.variant || "default"
				}
				size={iconOnly ? "icon-sm" : size}
				onClick={handleClick}
				disabled={isDisabled || isLoading}
				className={cn(
					presentation === "menu" &&
						"w-full justify-start rounded-[calc(var(--surface-radius)-2px)] px-3 py-2 text-left",
					action.variant === "destructive" &&
						presentation === "menu" &&
						"text-destructive hover:bg-destructive/10 hover:text-destructive",
					className,
				)}
				title={iconOnly ? label : undefined}
			>
				{iconElement}
				{iconOnly ? <span className="sr-only">{label}</span> : label}
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
