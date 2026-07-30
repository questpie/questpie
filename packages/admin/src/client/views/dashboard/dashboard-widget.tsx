/**
 * DashboardWidget Component
 *
 * Renders individual dashboard widgets based on their type configuration.
 * Resolves widgets from the registry (built-in + custom).
 */

import * as React from "react";

import type { AnyWidgetConfig, WidgetComponentProps } from "../../builder";
import { WidgetErrorBoundary } from "../../components/error-boundary";
import { useTranslation } from "../../i18n/hooks";
import { selectAdmin, useAdminStore } from "../../runtime";
import { WidgetCard } from "./widget-card";

// ============================================================================
// Types
// ============================================================================

interface DashboardWidgetProps {
	/**
	 * Widget configuration
	 */
	config: AnyWidgetConfig;

	/**
	 * Base path for navigation links
	 */
	basePath?: string;

	/**
	 * Navigate function for item clicks
	 */
	navigate?: (path: string) => void;

	/**
	 * Custom widget registry for overrides
	 */
	widgetRegistry?: Record<string, React.ComponentType<WidgetComponentProps>>;
}

// ============================================================================
// Loading & Error States
// ============================================================================

function UnknownWidget({ type }: { type: string }) {
	const { t } = useTranslation();
	return (
		<WidgetCard
			title={t("error.unknownWidget")}
			className="border-warning/20 bg-warning/5"
		>
			<p className="text-muted-foreground text-xs">
				{t("error.widgetTypeNotRecognized", { type })}
			</p>
		</WidgetCard>
	);
}

// ============================================================================
// Widget Renderer (handles lazy loading from registry)
// ============================================================================

interface RegistryWidgetRendererProps {
	loader: any;
	widgetConfig: AnyWidgetConfig;
	basePath: string;
	navigate?: (path: string) => void;
}

function RegistryWidgetRenderer({
	loader,
	widgetConfig,
	basePath,
	navigate,
}: RegistryWidgetRendererProps) {
	"use no memo";
	const { t } = useTranslation();
	const [state, setState] = React.useState<{
		Component: React.ComponentType<any> | null;
		loading: boolean;
		error: Error | null;
	}>({
		Component: null,
		loading: true,
		error: null,
	});

	React.useEffect(() => {
		if (!loader) {
			setState({ Component: null, loading: false, error: null });
			return;
		}

		// Check if it's already a component (not a lazy loader function)
		const isLazyLoader =
			typeof loader === "function" &&
			!loader.prototype?.render &&
			!loader.prototype?.isReactComponent &&
			loader.length === 0;

		if (!isLazyLoader) {
			setState({ Component: loader, loading: false, error: null });
			return;
		}

		// Load lazy component
		let mounted = true;

		(async () => {
			try {
				const result = await loader();
				if (mounted) {
					const Component = result.default || result;
					setState({ Component, loading: false, error: null });
				}
			} catch (err) {
				if (mounted) {
					setState({
						Component: null,
						loading: false,
						error:
							err instanceof Error
								? err
								: new Error(t("error.failedToLoadComponent")),
					});
				}
			}
		})();

		return () => {
			mounted = false;
		};
	}, [loader, t]);

	if (state.loading) {
		return <WidgetCard isLoading />;
	}

	if (state.error) {
		return <WidgetCard error={state.error} />;
	}

	if (!state.Component) {
		return <WidgetCard error={new Error(t("error.componentNotFound"))} />;
	}

	const Component = state.Component;
	return (
		<Component
			config={widgetConfig}
			basePath={basePath}
			navigate={navigate}
			span={widgetConfig.span}
		/>
	);
}

// ============================================================================
// Custom Widget Renderer (for type="custom" with inline component)
// ============================================================================

interface CustomWidgetRendererProps {
	loader: any;
	widgetConfig: Record<string, any>;
	span?: number;
}

function CustomWidgetRenderer({
	loader,
	widgetConfig,
	span,
}: CustomWidgetRendererProps) {
	"use no memo";
	const { t } = useTranslation();
	const [state, setState] = React.useState<{
		Component: React.ComponentType<WidgetComponentProps> | null;
		loading: boolean;
		error: Error | null;
	}>({
		Component: null,
		loading: true,
		error: null,
	});

	React.useEffect(() => {
		if (!loader) {
			setState({ Component: null, loading: false, error: null });
			return;
		}

		const isLazyLoader =
			typeof loader === "function" &&
			!loader.prototype?.render &&
			!loader.prototype?.isReactComponent &&
			loader.length === 0;

		if (!isLazyLoader) {
			setState({ Component: loader, loading: false, error: null });
			return;
		}

		let mounted = true;

		(async () => {
			try {
				const result = await loader();
				if (mounted) {
					const Component = result.default || result;
					setState({ Component, loading: false, error: null });
				}
			} catch (err) {
				if (mounted) {
					setState({
						Component: null,
						loading: false,
						error:
							err instanceof Error
								? err
								: new Error(t("error.failedToLoadComponent")),
					});
				}
			}
		})();

		return () => {
			mounted = false;
		};
	}, [loader, t]);

	if (state.loading) {
		return <WidgetCard isLoading />;
	}

	if (state.error) {
		return <WidgetCard error={state.error} />;
	}

	if (!state.Component) {
		return <WidgetCard error={new Error(t("error.componentNotFound"))} />;
	}

	const Component = state.Component;
	return <Component config={widgetConfig} span={span} />;
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * The registry key a widget config resolves to.
 *
 * `ServerCustomWidget` (server/augmentation/dashboard.ts:182-199) is
 * `{ type: "custom", widgetType, props }`, and `widgetType` is documented there
 * as "resolved by client registry". So for a custom widget the key is
 * `widgetType`, not the literal `"custom"` — the type discriminates the shape,
 * the widgetType names the component.
 *
 * Exported and pure so the resolution can be tested without a renderer; the
 * bug this replaced was invisible to every server-side test because it lived
 * entirely in the render path.
 */
export function resolveWidgetKey(config: {
	type: string;
	widgetType?: string;
}): string {
	if (config.type === "custom" && config.widgetType) return config.widgetType;
	return config.type;
}

/**
 * DashboardWidget - Renders a single widget based on its configuration.
 *
 * Resolves widgets from the admin store's widget registry (populated by
 * coreAdminModule and user extensions). Falls back to widgetRegistry prop
 * for overrides.
 */
export function DashboardWidget({
	config,
	basePath = "/admin",
	navigate,
	widgetRegistry,
}: DashboardWidgetProps): React.ReactElement {
	const admin = useAdminStore(selectAdmin);
	const registeredWidgets = admin.getWidgets() as Record<string, any>;

	let widgetElement: React.ReactElement;

	const widgetKey = resolveWidgetKey(config);

	// A custom widget that resolved to nothing else is the legacy inline form.
	if (config.type === "custom" && widgetKey === "custom") {
		// Legacy inline form: a component carried on the config itself. The
		// declared ServerCustomWidget has no `component`/`config` fields, so this
		// only fires for configs built outside that contract.
		widgetElement = (
			<CustomWidgetRenderer
				loader={config.component}
				widgetConfig={config.config || {}}
				span={config.span}
			/>
		);
	} else if (widgetRegistry?.[widgetKey]) {
		// Check prop-based registry for overrides first
		const CustomWidget = widgetRegistry[widgetKey];
		widgetElement = <CustomWidget config={config as any} span={config.span} />;
	} else {
		// Look up widget in the admin store registry (built-in + user-registered)
		const widgetDef = registeredWidgets[widgetKey];
		const component = widgetDef?.component ?? widgetDef?.state?.component;
		if (component) {
			widgetElement = (
				<RegistryWidgetRenderer
					loader={component}
					widgetConfig={config}
					basePath={basePath}
					navigate={navigate}
				/>
			);
		} else {
			// The key, not the discriminant — a missing custom widget should name
			// the widgetType the app registered under, not the word "custom".
			widgetElement = <UnknownWidget type={widgetKey} />;
		}
	}

	return (
		<div className="qa-dashboard-widget h-full min-h-0">
			<WidgetErrorBoundary widgetType={config.type}>
				{widgetElement}
			</WidgetErrorBoundary>
		</div>
	);
}
