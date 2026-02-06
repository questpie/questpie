/**
 * Recent Items Widget
 *
 * Displays latest items from a collection.
 * Uses WidgetCard for consistent styling.
 */

import { useCollectionList } from "../../hooks/use-collection";
import { useResolveText } from "../../i18n/hooks";
import { formatCollectionName } from "../../lib/utils";
import { WidgetCard } from "../../views/dashboard/widget-card";
import { RecentItemsWidgetSkeleton } from "./widget-skeletons";

/**
 * Recent items widget config (local type for component props)
 */
export type RecentItemsWidgetConfig = {
  collection: string;
  limit?: number;
  /** Field to use as title (default: "_title") */
  titleField?: string;
  /** Field to use for date (default: "createdAt") */
  dateField?: string;
  /** Fields to display as subtitle */
  subtitleFields?: string[];
  label?: string;
  realtime?: boolean;
  /** Base path for item links */
  basePath?: string;
  /** Click handler for items */
  onItemClick?: (item: any) => void;
};

/**
 * Recent items widget props
 */
export type RecentItemsWidgetProps = {
  config: RecentItemsWidgetConfig;
};

/**
 * Recent items widget component
 *
 * Displays:
 * - List of most recently created/updated items
 * - Configurable number of items
 * - Links to edit each item
 */
export default function RecentItemsWidget({ config }: RecentItemsWidgetProps) {
  const resolveText = useResolveText();
  const {
    collection,
    limit = 5,
    label,
    titleField = "_title",
    dateField = "createdAt",
    subtitleFields,
    onItemClick,
    realtime,
  } = config;

  // Fetch recent items sorted by date
  const { data, isLoading, error, refetch } = useCollectionList(
    collection as any,
    {
      orderBy: { [dateField]: "desc" },
      limit,
    } as any,
    undefined,
    { realtime },
  );

  // API returns PaginatedResult with { docs, totalDocs, ... }
  const items = Array.isArray(data?.docs) ? data.docs : [];
  const displayLabel = label
    ? resolveText(label)
    : `Recent ${formatCollectionName(collection)}`;

  // Determine title field - prefer _title computed field from backend
  const getTitleValue = (item: any): string => {
    if (titleField && item[titleField]) return String(item[titleField]);
    if (item._title) return String(item._title);
    if (item.name) return String(item.name);
    if (item.title) return String(item.title);
    if (item.label) return String(item.label);
    return `Item #${item.id}`;
  };

  // Get subtitle from fields
  const getSubtitle = (item: any): string | null => {
    if (!subtitleFields?.length) return null;
    return subtitleFields
      .map((field) => item[field])
      .filter(Boolean)
      .join(" - ");
  };

  // Handle item click
  const handleItemClick = (item: any) => {
    if (onItemClick) {
      onItemClick(item);
    }
  };

  // List content
  const listContent =
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">No items yet</p>
    ) : (
      <div className="space-y-1">
        {items.map((item: any) => {
          const dateValue = item[dateField];
          const subtitle = getSubtitle(item);

          return (
            <button
              type="button"
              key={item.id}
              onClick={() => handleItemClick(item)}
              className="flex w-full items-center gap-3 rounded-md p-2 hover:bg-muted/50 cursor-pointer transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {getTitleValue(item)}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {dateValue && (
                    <span>{formatRelativeTime(new Date(dateValue))}</span>
                  )}
                  {subtitle && (
                    <>
                      <span>-</span>
                      <span className="truncate">{subtitle}</span>
                    </>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );

  return (
    <WidgetCard
      title={displayLabel}
      isLoading={isLoading}
      loadingSkeleton={<RecentItemsWidgetSkeleton count={limit} />}
      error={
        error instanceof Error ? error : error ? new Error(String(error)) : null
      }
      onRefresh={() => refetch()}
    >
      {listContent}
    </WidgetCard>
  );
}

/**
 * Format relative time
 */
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return "just now";
}
