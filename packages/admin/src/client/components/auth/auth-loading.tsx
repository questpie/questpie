/**
 * Auth Loading Component
 *
 * Full-page loading state shown while checking authentication.
 * Used as the default loadingFallback in AuthGuard.
 */

import type * as React from "react";

import { cn } from "../../lib/utils";
import { Skeleton } from "../ui/skeleton";

// ============================================================================
// Types
// ============================================================================

interface AuthLoadingProps {
	/**
	 * Custom class name for the container
	 */
	className?: string;

	/**
	 * Loading message to display
	 * @default "Loading..."
	 */
	message?: string;

	/**
	 * Show the loading message
	 * @default true
	 */
	showMessage?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Full-page loading state for authentication
 *
 * @example
 * ```tsx
 * <AuthLoading message="Checking authentication..." />
 * ```
 */
export function AuthLoading({
	className,
	message = "Loading...",
	showMessage = true,
}: AuthLoadingProps): React.ReactElement {
	return (
		<div
			className={cn(
				"flex min-h-screen flex-col items-center justify-center gap-4 px-6",
				className,
			)}
			aria-busy="true"
		>
			<div className="w-full max-w-sm space-y-4">
				<Skeleton className="mx-auto size-12" />
				<div className="space-y-2">
					<Skeleton variant="text" className="mx-auto h-4 w-40" />
					<Skeleton variant="text" className="mx-auto h-3 w-56" />
				</div>
				<Skeleton className="h-10 w-full" />
			</div>
			{showMessage && (
				<p className="text-muted-foreground text-sm" role="status">
					{message}
				</p>
			)}
		</div>
	);
}
