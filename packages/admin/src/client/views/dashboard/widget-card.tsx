/**
 * WidgetCard Component
 *
 * Standardized card wrapper for dashboard widgets with multiple variants.
 * Provides consistent styling, header actions, and loading/error states.
 */

import { Icon } from "@iconify/react";
import type * as React from "react";
import type { WidgetAction, WidgetCardVariant } from "../../builder";
import { resolveIconElement } from "../../components/component-renderer";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { cn } from "../../lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface WidgetCardProps {
  /** Widget title */
  title?: string;
  /** Widget description */
  description?: string;
  /** Widget icon */
  icon?: WidgetAction["icon"];
  /** Card visual variant */
  variant?: WidgetCardVariant;
  /** Loading state (initial load) */
  isLoading?: boolean;
  /** Refreshing state (background refetch) */
  isRefreshing?: boolean;
  /** Error state */
  error?: Error | null;
  /** Refresh handler */
  onRefresh?: () => void;
  /** Expand handler (for full screen view) */
  onExpand?: () => void;
  /** Header actions */
  actions?: WidgetAction[];
  /** Custom CSS class */
  className?: string;
  /** Custom loading skeleton */
  loadingSkeleton?: React.ReactNode;
  /** Children content (optional when loading/error) */
  children?: React.ReactNode;
}

// ============================================================================
// Variant Styles
// ============================================================================

const variantStyles: Record<WidgetCardVariant, string> = {
  default: "",
  compact: "py-3 gap-3",
  featured:
    "border-primary/30 bg-gradient-to-br from-primary/5 to-transparent shadow-sm",
};

const variantContentStyles: Record<WidgetCardVariant, string> = {
  default: "",
  compact: "pt-0",
  featured: "",
};

// ============================================================================
// Sub-components
// ============================================================================

function WidgetCardLoading({
  variant = "default",
}: {
  variant?: WidgetCardVariant;
}) {
  return (
    <Card className={cn("h-full flex flex-col", variantStyles[variant])}>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent className={cn("flex-1", variantContentStyles[variant])}>
        <Skeleton className="h-20 w-full" />
      </CardContent>
    </Card>
  );
}

function WidgetCardError({
  error,
  variant = "default",
  onRetry,
}: {
  error: Error;
  variant?: WidgetCardVariant;
  onRetry?: () => void;
}) {
  return (
    <Card
      className={cn(
        "h-full flex flex-col border-destructive/20 bg-destructive/5",
        variantStyles[variant],
      )}
    >
      <CardHeader>
        <CardTitle className="text-sm font-medium text-destructive">
          Error
        </CardTitle>
        {onRetry && (
          <CardAction>
            <Button variant="ghost" size="icon-xs" onClick={onRetry}>
              <Icon icon="ph:arrow-clockwise" className="h-3.5 w-3.5" />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className={cn("flex-1", variantContentStyles[variant])}>
        <p className="text-xs text-muted-foreground">{error.message}</p>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * WidgetCard - Standardized card wrapper for dashboard widgets
 *
 * @example
 * ```tsx
 * <WidgetCard
 *   title="Revenue"
 *   description="Monthly sales total"
 *   variant="featured"
 *   onRefresh={() => refetch()}
 * >
 *   <div className="text-2xl font-bold">$12,345</div>
 * </WidgetCard>
 * ```
 */
export function WidgetCard({
  title,
  description,
  icon,
  variant = "default",
  isLoading,
  isRefreshing,
  error,
  onRefresh,
  onExpand,
  actions,
  className,
  loadingSkeleton,
  children,
}: WidgetCardProps): React.ReactElement {
  // Loading state
  if (isLoading) {
    if (loadingSkeleton) {
      return (
        <Card
          className={cn(
            "h-full flex flex-col",
            variantStyles[variant],
            className,
          )}
        >
          <CardHeader>
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent className={cn("flex-1", variantContentStyles[variant])}>
            {loadingSkeleton}
          </CardContent>
        </Card>
      );
    }
    return <WidgetCardLoading variant={variant} />;
  }

  // Error state
  if (error) {
    return (
      <WidgetCardError error={error} variant={variant} onRetry={onRefresh} />
    );
  }

  const hasHeader =
    title || description || icon || onRefresh || onExpand || actions?.length;

  return (
    <Card
      className={cn("h-full flex flex-col", variantStyles[variant], className)}
    >
      {hasHeader && (
        <CardHeader>
          <div className="flex items-center gap-2">
            {resolveIconElement(icon, {
              className: "h-4 w-4 text-muted-foreground",
            })}
            <div className="flex-1 min-w-0">
              {title && (
                <CardTitle className="text-sm font-medium truncate">
                  {title}
                </CardTitle>
              )}
              {description && (
                <CardDescription className="truncate">
                  {description}
                </CardDescription>
              )}
            </div>
          </div>
          {(onRefresh || onExpand || actions?.length) && (
            <CardAction>
              <div className="flex items-center gap-1">
                {actions?.map((action) => (
                  <Button
                    key={action.id}
                    variant="ghost"
                    size="icon-xs"
                    onClick={action.onClick}
                    title={action.label}
                  >
                    {resolveIconElement(action.icon, {
                      className: "h-3.5 w-3.5",
                    })}
                  </Button>
                ))}
                {onRefresh && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onRefresh}
                    title="Refresh"
                    disabled={isRefreshing}
                  >
                    <Icon
                      icon="ph:arrow-clockwise"
                      className={cn(
                        "h-3.5 w-3.5",
                        isRefreshing && "animate-spin",
                      )}
                    />
                  </Button>
                )}
                {onExpand && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onExpand}
                    title="Expand"
                  >
                    <Icon icon="ph:arrows-out-simple" className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </CardAction>
          )}
        </CardHeader>
      )}
      <CardContent
        className={cn(
          "flex-1",
          variantContentStyles[variant],
          !hasHeader && "pt-0",
        )}
      >
        {children}
      </CardContent>
    </Card>
  );
}

export default WidgetCard;
