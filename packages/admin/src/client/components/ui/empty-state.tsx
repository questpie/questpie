import { Icon as IconifyIcon } from "@iconify/react";
import type * as React from "react";

import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

type EmptyStateVariant = "empty" | "error" | "search";

interface EmptyStateProps {
	/**
	 * Title text
	 */
	title: string;

	/**
	 * Description text
	 */
	description?: string;

	/**
	 * Optional icon component
	 */
	icon?: React.ComponentType<{ className?: string }>;

	/**
	 * Optional Iconify icon name
	 */
	iconName?: string;

	/**
	 * Visual treatment
	 * @default "empty"
	 */
	variant?: EmptyStateVariant;

	/**
	 * Optional action button/element
	 */
	action?: React.ReactNode;

	/**
	 * Height of the empty state container
	 * @default "h-64"
	 */
	height?: string;

	/**
	 * Additional className
	 */
	className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * EmptyState - Empty state component with theme-adaptive styling
 *
 * @example
 * ```tsx
 * <EmptyState
 *   title="NO_RESULTS"
 *   description="Try adjusting your search or filters"
 * />
 *
 * <EmptyState
 *   title="NO_POSTS_YET"
 *   description="Create your first post to get started"
 *   action={<Button>Create Post</Button>}
 * />
 * ```
 */
export function EmptyState({
	title,
	description,
	icon: Icon,
	iconName,
	variant = "empty",
	action,
	height = "h-48",
	className,
}: EmptyStateProps): React.ReactElement {
	const resolvedIconName =
		iconName ??
		(variant === "error"
			? "ph:warning-circle"
			: variant === "search"
				? "ph:magnifying-glass"
				: "ph:tray");

	return (
		<div
			data-slot="empty-state"
			data-variant={variant}
			role={variant === "error" ? "alert" : undefined}
			className={cn(
				"qa-empty-state relative flex flex-col items-center justify-center px-6 py-8 text-center",
				height,
				className,
			)}
		>
			<div className="flex max-w-lg flex-col items-center">
				<div
					className={cn(
						"mb-3 flex size-8 items-center justify-center",
						variant === "error" ? "text-destructive" : "text-muted-foreground",
					)}
				>
					{Icon ? (
						<Icon className="size-5" />
					) : (
						<IconifyIcon icon={resolvedIconName} className="size-5" />
					)}
				</div>

				<p className="qa-empty-state__title text-foreground max-w-sm text-sm font-medium text-balance">
					{title}
				</p>

				{description && (
					<p className="qa-empty-state__description text-muted-foreground mt-1 max-w-md text-sm/relaxed text-pretty">
						{description}
					</p>
				)}

				{action && (
					<div className="qa-empty-state__action mt-4 flex flex-wrap items-center justify-center gap-2">
						{action}
					</div>
				)}
			</div>
		</div>
	);
}
