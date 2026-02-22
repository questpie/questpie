/**
 * Auth Loading Component
 *
 * Full-page loading state shown while checking authentication.
 * Used as the default loadingFallback in AuthGuard.
 */

import type * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../ui/spinner";

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
				"flex min-h-screen flex-col items-center justify-center gap-4",
				className,
			)}
		>
			<Spinner className="size-8 text-primary" />
			{showMessage && (
				<p className="text-sm text-muted-foreground">{message}</p>
			)}
		</div>
	);
}
