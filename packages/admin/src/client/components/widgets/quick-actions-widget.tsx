/**
 * Quick Actions Widget
 *
 * Displays shortcuts to common actions with icons and proper styling.
 * Uses WidgetCard for consistent styling.
 */

import { Icon } from "@iconify/react";

import type { QuickActionsWidgetConfig } from "../../builder/types/widget-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { cn, formatLabel } from "../../lib/utils";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { WidgetEmptyState } from "./widget-empty-state";

type ServerQuickActionTarget =
	| { type: "create"; collection: string }
	| { type: "link"; href: string; external?: boolean }
	| { type: "page"; pageId: string };

/**
 * Quick actions widget props
 */
interface QuickActionsWidgetProps {
	config: QuickActionsWidgetConfig & {
		title?: any;
		description?: any;
		label?: any;
		cardVariant?: "default" | "compact" | "featured";
		className?: string;
		actions?: Array<{
			label: any;
			icon?: any;
			href?: string;
			onClick?: () => void;
			variant?: "default" | "primary" | "secondary" | "outline";
			action?: ServerQuickActionTarget;
		}>;
	};
	basePath?: string;
	navigate?: (path: string) => void;
}

/**
 * Quick actions widget component
 *
 * Displays a list of action items with icons, matching the style
 * of other dashboard widgets like recent-items.
 */
export default function QuickActionsWidget({
	config,
	basePath = "/admin",
	navigate,
}: QuickActionsWidgetProps) {
	const resolveText = useResolveText();
	const { t } = useTranslation();
	const { layout = "list" } = config;
	const quickActions = config.quickActions ?? config.actions ?? [];
	const title = config.title
		? resolveText(config.title)
		: config.label
			? resolveText(config.label)
			: t("dashboard.quickActions");

	const resolveActionHref = (
		action: ServerQuickActionTarget | undefined,
		fallback?: string,
	) => {
		if (!action) return fallback;
		if (action.type === "create") {
			return `${basePath}/collections/${action.collection}/create`;
		}
		if (action.type === "page") {
			return `${basePath}/${action.pageId}`;
		}
		return action.href;
	};

	// Parse actions - handle both string shortcuts and full config objects
	const parsedActions = quickActions.map((action, index) => {
		if (typeof action === "string") {
			// Format: "collection.action" e.g., "posts.create"
			const [collection, actionType] = action.split(".");
			return {
				id: `${action}-${index}`,
				label:
					actionType === "create"
						? t("collection.new", { name: formatLabel(collection) })
						: `${actionType} ${formatLabel(collection)}`,
				href: `${basePath}/collections/${collection}/${actionType === "create" ? "create" : ""}`,
				icon: undefined,
				variant: "default" as const,
			};
		}
		const serverAction =
			"action" in action
				? (action.action as ServerQuickActionTarget | undefined)
				: undefined;
		return {
			id: `action-${index}`,
			label: resolveText(action.label),
			href: resolveActionHref(serverAction, action.href),
			external: serverAction?.type === "link" ? serverAction.external : false,
			onClick: action.onClick,
			icon: action.icon,
			variant: action.variant || ("default" as const),
		};
	});

	// Handle action click
	const handleClick = (action: (typeof parsedActions)[0]) => {
		if (action.onClick) {
			action.onClick();
		} else if (action.href && action.external) {
			window.open(action.href, "_blank", "noopener,noreferrer");
		} else if (action.href && navigate) {
			navigate(action.href);
		}
	};

	// Variant styles for the action items
	const variantStyles = {
		default:
			"border-border-subtle bg-surface-low/60 hover:border-border hover:bg-surface-high cursor-pointer",
		primary:
			"border-primary/30 bg-primary/10 text-foreground hover:border-primary/45 hover:bg-primary/15 [&_svg]:text-primary cursor-pointer",
		secondary:
			"border-border-subtle bg-secondary/60 hover:bg-secondary cursor-pointer",
		outline: "border-border bg-background hover:bg-muted cursor-pointer",
	};

	const iconVariantStyles = {
		default: "bg-muted text-muted-foreground",
		primary: "bg-primary/15 text-primary",
		secondary: "bg-secondary text-secondary-foreground",
		outline: "bg-background text-muted-foreground",
	};

	// Empty state
	if (parsedActions.length === 0) {
		return (
			<WidgetCard
				title={title}
				description={
					config.description ? resolveText(config.description) : undefined
				}
				variant={config.cardVariant}
				className={config.className}
			>
				<WidgetEmptyState
					iconName="ph:lightning"
					title={t("widget.quickActions.emptyTitle")}
					description={t("widget.quickActions.emptyDescription")}
				/>
			</WidgetCard>
		);
	}

	// Grid layout
	if (layout === "grid") {
		return (
			<WidgetCard
				title={title}
				description={
					config.description ? resolveText(config.description) : undefined
				}
				variant={config.cardVariant}
				className={config.className}
			>
				<div className="grid h-full grid-cols-2 gap-3">
					{parsedActions.map((action) => {
						const iconElement = resolveIconElement(action.icon, {
							className: "h-4 w-4",
						});

						return (
							<button
								key={action.id}
								type="button"
								onClick={() => handleClick(action)}
								className={cn(
									"flex min-h-24 flex-col items-center justify-center gap-2 rounded-md border p-3 text-center",
									"transition-[background-color,border-color,transform] active:scale-[0.96]",
									variantStyles[action.variant],
								)}
							>
								{iconElement && (
									<div
										className={cn(
											"flex h-9 w-9 items-center justify-center rounded-md",
											iconVariantStyles[action.variant],
										)}
									>
										{iconElement}
									</div>
								)}
								<span className="text-xs leading-tight font-medium text-balance">
									{action.label}
								</span>
							</button>
						);
					})}
				</div>
			</WidgetCard>
		);
	}

	// List layout (default) - matches recent-items style
	return (
		<WidgetCard
			title={title}
			description={
				config.description ? resolveText(config.description) : undefined
			}
			variant={config.cardVariant}
			className={config.className}
		>
			<div className="-mx-1 space-y-1">
				{parsedActions.map((action) => {
					const iconElement = resolveIconElement(action.icon, {
						className: "h-4 w-4",
					});

					return (
						<button
							key={action.id}
							type="button"
							onClick={() => handleClick(action)}
							className={cn(
								"group flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-[background-color,transform] active:scale-[0.96]",
								variantStyles[action.variant],
							)}
						>
							{iconElement && (
								<div
									className={cn(
										"flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
										iconVariantStyles[action.variant],
									)}
								>
									{iconElement}
								</div>
							)}
							<span className="flex-1 truncate text-sm font-medium">
								{action.label}
							</span>
							<Icon
								icon="ph:arrow-right"
								className="text-muted-foreground h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100"
							/>
						</button>
					);
				})}
			</div>
		</WidgetCard>
	);
}
