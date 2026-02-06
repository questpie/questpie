/**
 * Quick Actions Widget
 *
 * Displays shortcuts to common actions with icons and proper styling.
 * Uses WidgetCard for consistent styling.
 */

import { Icon } from "@iconify/react";
import type * as React from "react";
import type { QuickActionsWidgetConfig } from "../../builder/types/widget-types";
import { resolveIconElement } from "../../components/component-renderer";
import { useResolveText } from "../../i18n/hooks";
import { cn, formatCollectionName } from "../../lib/utils";
import { WidgetCard } from "../../views/dashboard/widget-card";

/**
 * Quick actions widget props
 */
export interface QuickActionsWidgetProps {
  config: QuickActionsWidgetConfig;
  basePath?: string;
  navigate?: (path: string) => void;
}

/**
 * Quick actions widget component
 *
 * Displays a list of action items with icons, matching the style
 * of other dashboard widgets like recent-items.
 */
export default function QuickActionsWidget({
  config,
  basePath = "/admin",
  navigate,
}: QuickActionsWidgetProps) {
  const resolveText = useResolveText();
  const { quickActions, layout = "list" } = config;
  const title = config.title ? resolveText(config.title) : "Quick Actions";

  // Parse actions - handle both string shortcuts and full config objects
  const parsedActions = quickActions.map((action, index) => {
    if (typeof action === "string") {
      // Format: "collection.action" e.g., "posts.create"
      const [collection, actionType] = action.split(".");
      return {
        id: `${action}-${index}`,
        label: `${actionType === "create" ? "New" : actionType} ${formatCollectionName(collection)}`,
        href: `${basePath}/collections/${collection}/${actionType === "create" ? "create" : ""}`,
        icon: undefined,
        variant: "default" as const,
      };
    }
    return {
      id: `action-${index}`,
      label: resolveText(action.label),
      href: action.href,
      onClick: action.onClick,
      icon: action.icon,
      variant: action.variant || ("default" as const),
    };
  });

  // Handle action click
  const handleClick = (action: (typeof parsedActions)[0]) => {
    if (action.onClick) {
      action.onClick();
    } else if (action.href && navigate) {
      navigate(action.href);
    }
  };

  // Variant styles for the action items
  const variantStyles = {
    default: "hover:bg-muted/50 cursor-pointer",
    primary:
      "bg-primary/5 hover:bg-primary/10 border-primary/20 text-primary [&_svg]:text-primary cursor-pointer",
    secondary: "hover:bg-secondary cursor-pointer",
    outline: "border border-border hover:bg-muted/50 cursor-pointer",
  };

  const iconVariantStyles = {
    default: "bg-muted text-muted-foreground",
    primary: "bg-primary/10 text-primary",
    secondary: "bg-secondary text-secondary-foreground",
    outline: "bg-background text-muted-foreground",
  };

  // Empty state
  if (parsedActions.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">No actions configured</p>
      </WidgetCard>
    );
  }

  // Grid layout
  if (layout === "grid") {
    return (
      <WidgetCard title={title}>
        <div className="grid grid-cols-2 gap-2">
          {parsedActions.map((action) => {
            const iconElement = resolveIconElement(action.icon, {
              className: "h-4 w-4",
            });

            return (
              <button
                key={action.id}
                type="button"
                onClick={() => handleClick(action)}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-md p-3 text-center transition-colors",
                  variantStyles[action.variant],
                )}
              >
                {iconElement && (
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-md",
                      iconVariantStyles[action.variant],
                    )}
                  >
                    {iconElement}
                  </div>
                )}
                <span className="text-xs font-medium">{action.label}</span>
              </button>
            );
          })}
        </div>
      </WidgetCard>
    );
  }

  // List layout (default) - matches recent-items style
  return (
    <WidgetCard title={title}>
      <div className="space-y-1 -mx-1">
        {parsedActions.map((action) => {
          const iconElement = resolveIconElement(action.icon, {
            className: "h-4 w-4",
          });

          return (
            <button
              key={action.id}
              type="button"
              onClick={() => handleClick(action)}
              className={cn(
                "flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors",
                variantStyles[action.variant],
              )}
            >
              {iconElement && (
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                    iconVariantStyles[action.variant],
                  )}
                >
                  {iconElement}
                </div>
              )}
              <span className="flex-1 text-sm font-medium truncate">
                {action.label}
              </span>
              <Icon
                icon="ph:arrow-right"
                className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </button>
          );
        })}
      </div>
    </WidgetCard>
  );
}
