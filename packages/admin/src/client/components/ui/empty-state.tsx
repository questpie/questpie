import type * as React from "react";
import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

interface EmptyStateProps {
	/**
	 * Title text (displayed in mono uppercase)
	 * @example "NO_DATA_FOUND"
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
 * EmptyState - Cyber-styled empty state component
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
	action,
	height = "h-48",
	className,
}: EmptyStateProps): React.ReactElement {
	return (
		<div
			data-slot="empty-state"
			className={cn(
				"qa-empty-state relative flex flex-col items-center justify-center",
				"border border-dashed border-border bg-card",
				height,
				className,
			)}
		>
			<div className="text-center">
				{/* Glow dot or icon */}
				{Icon ? (
					<Icon className="mx-auto mb-4 size-8 text-muted-foreground/50" />
				) : (
					<div className="mx-auto mb-4 size-1.5 bg-primary" />
				)}

				{/* Title */}
				<p className="font-mono text-sm uppercase tracking-wider text-muted-foreground">
					{title}
				</p>

				{/* Description */}
				{description && (
					<p className="mt-2 text-xs text-muted-foreground/60">{description}</p>
				)}

				{/* Action */}
				{action && <div className="mt-4">{action}</div>}
			</div>
		</div>
	);
}
