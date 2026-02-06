/**
 * DashboardWidget Component
 *
 * Renders individual dashboard widgets based on their type configuration.
 * Resolves widgets from the registry (built-in + custom).
 */

import * as React from "react";
import type { AnyWidgetConfig, WidgetComponentProps } from "../../builder";
import { WidgetErrorBoundary } from "../../components/error-boundary";
import { selectAdmin, useAdminStore } from "../../runtime";
import { WidgetCard } from "./widget-card";

// ============================================================================
// Types
// ============================================================================

export interface DashboardWidgetProps {
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
  return (
    <WidgetCard
      title="Unknown Widget"
      className="border-yellow-500/20 bg-yellow-500/5"
    >
      <p className="text-xs text-muted-foreground">
        Widget type "{type}" is not recognized.
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
                : new Error("Failed to load component"),
          });
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loader]);

  if (state.loading) {
    return <WidgetCard isLoading />;
  }

  if (state.error) {
    return <WidgetCard error={state.error} />;
  }

  if (!state.Component) {
    return <WidgetCard error={new Error("Component not found")} />;
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
                : new Error("Failed to load component"),
          });
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [loader]);

  if (state.loading) {
    return <WidgetCard isLoading />;
  }

  if (state.error) {
    return <WidgetCard error={state.error} />;
  }

  if (!state.Component) {
    return <WidgetCard error={new Error("Component not found")} />;
  }

  const Component = state.Component;
  return <Component config={widgetConfig} span={span} />;
}

// ============================================================================
// Main Component
// ============================================================================

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

  const renderWidget = (): React.ReactElement => {
    // Handle custom widget type (inline component, not from registry)
    if (config.type === "custom") {
      return (
        <CustomWidgetRenderer
          loader={config.component}
          widgetConfig={config.config || {}}
          span={config.span}
        />
      );
    }

    // Check prop-based registry for overrides first
    if (widgetRegistry?.[config.type]) {
      const CustomWidget = widgetRegistry[config.type];
      return <CustomWidget config={config as any} span={config.span} />;
    }

    // Look up widget in the admin store registry (built-in + user-registered)
    const widgetDef = registeredWidgets[config.type];
    if (widgetDef) {
      const component = widgetDef.component ?? widgetDef.state?.component;
      if (component) {
        return (
          <RegistryWidgetRenderer
            loader={component}
            widgetConfig={config}
            basePath={basePath}
            navigate={navigate}
          />
        );
      }
    }

    return <UnknownWidget type={config.type} />;
  };

  return (
    <WidgetErrorBoundary widgetType={config.type}>
      {renderWidget()}
    </WidgetErrorBoundary>
  );
}

export default DashboardWidget;
