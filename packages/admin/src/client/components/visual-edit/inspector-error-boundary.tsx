/**
 * InspectorErrorBoundary
 *
 * Wraps a section of the Visual Edit inspector so a misbehaving
 * field component or block schema doesn't unmount the whole
 * workspace. Render-prop boundaries get rebuilt cheaply on
 * recovery (`tryAgain`), so this also doubles as a soft reset
 * when the user navigates between selections.
 *
 * Class component because React still doesn't have a hook
 * equivalent for `componentDidCatch`. Keep the surface small —
 * production code should reach for a project-level reporter
 * (Sentry, etc.) via `onError`.
 */

"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import { Button } from "../ui/button.js";

// ============================================================================
// Types
// ============================================================================

export type InspectorErrorBoundaryProps = {
	children: React.ReactNode;
	/**
	 * Stable key that resets the boundary when it changes — useful
	 * for clearing the error when the user navigates to a new
	 * selection. Pass the current `selection.kind` plus relevant
	 * ids (e.g. `${kind}:${blockId}`) so each target gets a fresh
	 * try.
	 */
	resetKey?: string;
	/**
	 * Hook for project-level reporters. Called once per caught
	 * error before the fallback UI renders.
	 */
	onError?: (error: Error, info: React.ErrorInfo) => void;
	/** Optional custom fallback. Receives the error + retry handler. */
	fallback?: (args: { error: Error; retry: () => void }) => React.ReactNode;
};

type State = { error: Error | null };

// ============================================================================
// Component
// ============================================================================

export class InspectorErrorBoundary extends React.Component<
	InspectorErrorBoundaryProps,
	State
> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: React.ErrorInfo): void {
		this.props.onError?.(error, info);
		if (process.env.NODE_ENV !== "production") {
			console.error(
				"[VisualEdit] Inspector boundary caught an error:",
				error,
				info,
			);
		}
	}

	componentDidUpdate(prev: InspectorErrorBoundaryProps): void {
		// Reset the boundary when the resetKey changes — typically
		// because the user picked a different selection target.
		if (this.state.error && prev.resetKey !== this.props.resetKey) {
			this.setState({ error: null });
		}
	}

	private retry = (): void => {
		this.setState({ error: null });
	};

	render(): React.ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;

		if (this.props.fallback) {
			return this.props.fallback({ error, retry: this.retry });
		}
		return <DefaultFallback error={error} retry={this.retry} />;
	}
}

// ============================================================================
// Default fallback
// ============================================================================

function DefaultFallback({
	error,
	retry,
}: {
	error: Error;
	retry: () => void;
}) {
	return (
		<div className="border-destructive/40 bg-destructive/5 m-3 rounded border p-3">
			<div className="text-destructive flex items-center gap-2 text-sm font-medium">
				<Icon icon="ph:warning" className="h-4 w-4" />
				<span>Something went wrong rendering this field.</span>
			</div>
			<pre className="text-muted-foreground mt-2 overflow-x-auto text-xs">
				{error.message}
			</pre>
			<div className="mt-3">
				<Button size="sm" variant="outline" onClick={retry}>
					Try again
				</Button>
			</div>
		</div>
	);
}
