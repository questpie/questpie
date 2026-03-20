/**
 * WidgetCard Component
 *
 * Standardized card wrapper for dashboard widgets with multiple variants.
 * Provides consistent styling, header actions, and loading/error states.
 */

import { Icon } from "@iconify/react";
import type * as React from "react";

import type { WidgetAction, WidgetCardVariant } from "../../builder";
import { resolveIconElement } from "../../components/component-renderer";
import { Button } from "../../components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "../../components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Skeleton } from "../../components/ui/skeleton";
import { useTranslation } from "../../i18n/hooks";
import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

interface WidgetCardProps {
	/** Widget title */
	title?: string;
	/** Widget description */
	description?: string;
	/** Widget icon */
	icon?: WidgetAction["icon"];
	/** Card visual variant */
	variant?: WidgetCardVariant;
	/** Loading state (initial load) */
	isLoading?: boolean;
	/** Refreshing state (background refetch) */
	isRefreshing?: boolean;
	/** Error state */
	error?: Error | null;
	/** Refresh handler */
	onRefresh?: () => void;
	/** Expand handler (for full screen view) */
	onExpand?: () => void;
	/** Header actions */
	actions?: WidgetAction[];
	/** Custom CSS class */
	className?: string;
	/** Custom loading skeleton */
	loadingSkeleton?: React.ReactNode;
	/** Children content (optional when loading/error) */
	children?: React.ReactNode;
}

// ============================================================================
// Variant Styles
// ============================================================================

const variantStyles: Record<WidgetCardVariant, string> = {
	default: "",
	compact: "py-3 gap-3",
	featured:
		"border-primary/30 bg-gradient-to-br from-primary/5 to-transparent shadow-sm",
};

const variantContentStyles: Record<WidgetCardVariant, string> = {
	default: "",
	compact: "pt-0",
	featured: "",
};

// ============================================================================
// Sub-components
// ============================================================================

function WidgetCardLoading({
	variant = "default",
}: {
	variant?: WidgetCardVariant;
}) {
	return (
		<Card className={cn("flex h-full flex-col", variantStyles[variant])}>
			<CardHeader>
				<Skeleton className="h-4 w-24" />
			</CardHeader>
			<CardContent className={cn("flex-1", variantContentStyles[variant])}>
				<Skeleton className="h-20 w-full" />
			</CardContent>
		</Card>
	);
}

function WidgetCardError({
	error,
	variant = "default",
	onRetry,
}: {
	error: Error;
	variant?: WidgetCardVariant;
	onRetry?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<Card
			className={cn(
				"border-destructive/20 bg-destructive/5 flex h-full flex-col",
				variantStyles[variant],
			)}
		>
			<CardHeader>
				<CardTitle className="text-destructive text-sm font-medium">
					{t("toast.error")}
				</CardTitle>
				{onRetry && (
					<CardAction>
						<Button variant="ghost" size="icon-xs" onClick={onRetry}>
							<Icon icon="ph:arrow-clockwise" className="h-3.5 w-3.5" />
						</Button>
					</CardAction>
				)}
			</CardHeader>
			<CardContent className={cn("flex-1", variantContentStyles[variant])}>
				<p className="text-muted-foreground text-xs">{error.message}</p>
			</CardContent>
		</Card>
	);
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * WidgetCard - Standardized card wrapper for dashboard widgets
 *
 * @example
 * ```tsx
 * <WidgetCard
 *   title="Revenue"
 *   description="Monthly sales total"
 *   variant="featured"
 *   onRefresh={() => refetch()}
 * >
 *   <div className="text-2xl font-bold">$12,345</div>
 * </WidgetCard>
 * ```
 */
export function WidgetCard({
	title,
	description,
	icon,
	variant = "default",
	isLoading,
	isRefreshing,
	error,
	onRefresh,
	onExpand,
	actions,
	className,
	loadingSkeleton,
	children,
}: WidgetCardProps): React.ReactElement {
	const { t } = useTranslation();
	// Loading state
	if (isLoading) {
		if (loadingSkeleton) {
			return (
				<Card
					className={cn(
						"flex h-full flex-col",
						variantStyles[variant],
						className,
					)}
				>
					<CardHeader>
						<Skeleton className="h-4 w-24" />
					</CardHeader>
					<CardContent className={cn("flex-1", variantContentStyles[variant])}>
						{loadingSkeleton}
					</CardContent>
				</Card>
			);
		}
		return <WidgetCardLoading variant={variant} />;
	}

	// Error state
	if (error) {
		return (
			<WidgetCardError error={error} variant={variant} onRetry={onRefresh} />
		);
	}

	const hasHeader =
		title || description || icon || onRefresh || onExpand || actions?.length;

	return (
		<Card
			className={cn(
				"qa-widget-card flex h-full flex-col",
				variantStyles[variant],
				className,
			)}
		>
			{hasHeader && (
				<CardHeader className="qa-widget-card__header">
					<div className="flex items-center gap-2">
						{resolveIconElement(icon, {
							className: "h-4 w-4 text-muted-foreground",
						})}
						<div className="min-w-0 flex-1">
							{title && (
								<CardTitle className="truncate text-sm font-medium">
									{title}
								</CardTitle>
							)}
							{description && (
								<CardDescription className="truncate">
									{description}
								</CardDescription>
							)}
						</div>
					</div>
					{(onRefresh || onExpand || actions?.length) && (
						<CardAction>
							<div className="flex items-center gap-1">
								{/* Show first action directly, rest in dropdown on small widgets */}
								{actions && actions.length > 0 && (
									<>
										{/* First action always visible */}
										<Button
											key={actions[0].id}
											variant="ghost"
											size="icon-xs"
											onClick={actions[0].onClick}
											title={actions[0].label}
										>
											{resolveIconElement(actions[0].icon, {
												className: "h-3.5 w-3.5",
											})}
										</Button>
										{/* Additional actions in dropdown */}
										{actions.length > 1 && (
											<DropdownMenu>
												<DropdownMenuTrigger
													render={
														<Button variant="ghost" size="icon-xs">
															<Icon
																icon="ph:dots-three-vertical"
																className="h-3.5 w-3.5"
															/>
														</Button>
													}
												/>
												<DropdownMenuContent align="end">
													{actions.slice(1).map((action) => (
														<DropdownMenuItem
															key={action.id}
															onClick={action.onClick}
														>
															{resolveIconElement(action.icon, {
																className: "h-3.5 w-3.5 mr-2",
															})}
															{action.label}
														</DropdownMenuItem>
													))}
												</DropdownMenuContent>
											</DropdownMenu>
										)}
									</>
								)}
								{onRefresh && (
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={onRefresh}
										title={t("common.refresh")}
										disabled={isRefreshing}
									>
										<Icon
											icon="ph:arrow-clockwise"
											className={cn(
												"h-3.5 w-3.5",
												isRefreshing && "animate-spin",
											)}
										/>
									</Button>
								)}
								{onExpand && (
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={onExpand}
										title={t("ui.expand")}
									>
										<Icon icon="ph:arrows-out-simple" className="h-3.5 w-3.5" />
									</Button>
								)}
							</div>
						</CardAction>
					)}
				</CardHeader>
			)}
			<CardContent
				className={cn(
					"qa-widget-card__content flex-1",
					variantContentStyles[variant],
					!hasHeader && "pt-0",
				)}
			>
				{children}
			</CardContent>
		</Card>
	);
}
