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
