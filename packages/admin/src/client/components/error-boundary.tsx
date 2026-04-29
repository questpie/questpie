"use client";

import * as React from "react";

import { useTranslation } from "../i18n/hooks";

interface ErrorBoundaryProps {
	children: React.ReactNode;
	fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
	onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
	hasError: boolean;
	error: Error | null;
}

/**
 * Default fallback component for ErrorBoundary (functional, so it can use hooks)
 */
function DefaultErrorFallback({ error }: { error: Error }) {
	const { t } = useTranslation();
	return (
		<div className="border-destructive/20 bg-destructive/5 border p-4">
			<p className="text-destructive text-sm font-medium">
				{t("error.somethingWentWrong")}
			</p>
			<p className="text-muted-foreground mt-1 text-xs">{error.message}</p>
		</div>
	);
}

/**
 * ErrorBoundary - Catches JavaScript errors in child component tree
 *
 * Prevents entire UI from crashing when a component throws an error.
 * Use around widgets, sections, or any component that might fail.
 *
 * @example
 * ```tsx
 * <ErrorBoundary fallback={<WidgetError />}>
 *   <ChartWidget config={config} />
 * </ErrorBoundary>
 *
 * // With error callback
 * <ErrorBoundary
 *   fallback={(error) => <p>Error: {error.message}</p>}
 *   onError={(error) => logToService(error)}
 * >
 *   <DashboardWidget config={config} />
 * </ErrorBoundary>
 * ```
 */
class ErrorBoundary extends React.Component<
	ErrorBoundaryProps,
	ErrorBoundaryState
> {
	constructor(props: ErrorBoundaryProps) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error): ErrorBoundaryState {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		this.props.onError?.(error, errorInfo);
	}

	render(): React.ReactNode {
		if (this.state.hasError && this.state.error) {
			const { fallback } = this.props;

			if (typeof fallback === "function") {
				return fallback(this.state.error);
			}

			if (fallback) {
				return fallback;
			}

			// Default fallback (uses functional component to access hooks)
			return <DefaultErrorFallback error={this.state.error} />;
		}

		return this.props.children;
	}
}

/**
 * WidgetErrorBoundary - Specialized error boundary for dashboard widgets
 */
export function WidgetErrorBoundary({
	children,
	widgetType,
}: {
	children: React.ReactNode;
	widgetType?: string;
}) {
	const { t } = useTranslation();
	return (
		<ErrorBoundary
			fallback={(error) => (
				<div className="border-destructive/20 bg-destructive/5 border p-4">
					<p className="text-destructive text-sm font-medium">
						{t("error.widgetError")}
					</p>
					{widgetType && (
						<p className="text-muted-foreground text-xs">Type: {widgetType}</p>
					)}
					<p className="text-muted-foreground mt-1 text-xs">{error.message}</p>
				</div>
			)}
		>
			{children}
		</ErrorBoundary>
	);
}

/**
 * ViewErrorBoundary - Error boundary for collection views (table, form)
 *
 * Use with Suspense boundaries to gracefully handle loading and error states.
 *
 * @example
 * ```tsx
 * <ViewErrorBoundary viewType="table" collection="posts">
 *   <Suspense fallback={<TableViewSkeleton />}>
 *     <TableViewInner collection="posts" />
 *   </Suspense>
 * </ViewErrorBoundary>
 * ```
 */
function ViewErrorBoundary({
	children,
	viewType,
	collection,
	onRetry,
}: {
	children: React.ReactNode;
	viewType?: "table" | "form" | string;
	collection?: string;
	onRetry?: () => void;
}) {
	const { t } = useTranslation();
	return (
		<ErrorBoundary
			fallback={(error) => (
				<div className="container">
					<div className="border-destructive/20 bg-destructive/5 my-8 border p-6">
						<div className="flex items-start gap-4">
							<div className="bg-destructive/10 rounded-full p-2">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									className="text-destructive size-5"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
								>
									<title>Error</title>
									<circle cx="12" cy="12" r="10" />
									<line x1="12" y1="8" x2="12" y2="12" />
									<line x1="12" y1="16" x2="12.01" y2="16" />
								</svg>
							</div>
							<div className="flex-1">
								<h3 className="text-destructive text-sm font-semibold">
									{collection
										? t("error.failedToLoadViewFor", {
												viewType: viewType ?? "view",
												collection,
											})
										: t("error.failedToLoadView", {
												viewType: viewType ?? "view",
											})}
								</h3>
								<p className="text-muted-foreground mt-1 text-sm">
									{error.message || t("error.unexpectedError")}
								</p>
								{onRetry && (
									<button
										type="button"
										onClick={onRetry}
										className="text-foreground mt-3 text-sm font-medium underline-offset-4 hover:underline"
									>
										{t("error.tryAgain")}
									</button>
								)}
							</div>
						</div>
					</div>
				</div>
			)}
		>
			{children}
		</ErrorBoundary>
	);
}
