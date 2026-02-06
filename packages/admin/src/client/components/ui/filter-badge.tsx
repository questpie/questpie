import { Icon } from "@iconify/react";
import type * as React from "react";
import { useResolveText } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import { cn } from "../../lib/utils";
import { Badge } from "./badge";

// ============================================================================
// Types
// ============================================================================

export interface FilterBadgeProps {
  /**
   * Number of active filters
   */
  count: number;

  /**
   * Label for the filter type
   * @default "filter"
   */
  label?: I18nText;

  /**
   * Callback when clear button is clicked
   */
  onClear?: () => void;

  /**
   * Additional className
   */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * FilterBadge - Badge showing count of active filters with optional clear button
 *
 * @example
 * ```tsx
 * <FilterBadge
 *   count={3}
 *   onClear={() => clearFilters()}
 * />
 *
 * <FilterBadge
 *   count={2}
 *   label="column"
 *   onClear={() => resetColumns()}
 * />
 * ```
 */
export function FilterBadge({
  count,
  label = "filter",
  onClear,
  className,
}: FilterBadgeProps): React.ReactElement | null {
  const resolveText = useResolveText();
  const resolvedLabel = resolveText(label ?? "filter");
  if (count === 0) return null;

  const pluralLabel = count !== 1 ? `${resolvedLabel}s` : resolvedLabel;

  return (
    <Badge variant="secondary" className={cn("gap-1.5", className)}>
      <Icon icon="ph:funnel-fill" width={12} height={12} />
      {count} active {pluralLabel}
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="ml-1 hover:text-foreground transition-colors"
          aria-label={`Clear ${pluralLabel}`}
        >
          <Icon icon="ph:x" width={10} height={10} />
        </button>
      )}
    </Badge>
  );
}
