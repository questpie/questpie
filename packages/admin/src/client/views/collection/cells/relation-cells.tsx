/**
 * Relation Cell Components
 *
 * Cells for displaying relation fields:
 * - RelationCell - forward relations (belongs-to, has-one, has-many)
 * - ReverseRelationCell - reverse relations (computed from other collections)
 */

import * as React from "react";
import type { FieldDefinition } from "../../../builder/field/field";
import { ResourceSheet } from "../../../components/sheets";
import { Badge } from "../../../components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import { useResolveText } from "../../../i18n/hooks";
import { cn } from "../../../lib/utils";
import { getRelationItemId, getRelationItemLabel } from "./shared/cell-helpers";
import { RelationChip } from "./shared/relation-chip";

// ============================================================================
// Relation Cell
// ============================================================================

/**
 * Relation cell - displays relation as clickable chips
 * Supports both single relations and arrays
 * Opens detail sheet on click
 */
export function RelationCell({
  value,
  fieldDef,
}: {
  value: unknown;
  row?: unknown;
  fieldDef?: FieldDefinition;
}) {
  const resolveText = useResolveText();
  const targetCollection = fieldDef?.["~options"]?.targetCollection as
    | string
    | undefined;

  // Sheet state
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetItemId, setSheetItemId] = React.useState<string | undefined>();
  const [sheetCollection, setSheetCollection] = React.useState<
    string | undefined
  >();

  const handleChipClick = React.useCallback(
    (itemId: string, collection: string) => {
      setSheetItemId(itemId);
      setSheetCollection(collection);
      setSheetOpen(true);
    },
    [],
  );

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  // Handle array of relations (multiple)
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    const visibleItems = value.slice(0, 3);
    const remainingCount = value.length - 3;

    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex flex-wrap items-center gap-1 max-w-[250px]">
                {visibleItems.map((item, idx) => (
                  <RelationChip
                    // biome-ignore lint/suspicious/noArrayIndexKey: stable array from backend
                    key={idx}
                    item={item}
                    targetCollection={targetCollection}
                    onClick={handleChipClick}
                  />
                ))}
                {remainingCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="h-5 px-1.5 text-[10px] shrink-0"
                  >
                    +{remainingCount}
                  </Badge>
                )}
              </span>
            }
          />
          {value.length > 3 && (
            <TooltipContent side="bottom" align="start" className="p-0 w-56">
              <div className="max-h-[200px] overflow-y-auto p-2 space-y-1">
                {value.map((item, idx) => {
                  const label = resolveText(getRelationItemLabel(item));
                  const id = getRelationItemId(item);
                  const canNavigate = targetCollection && id;
                  const key = id ?? label ?? `item-${idx}`;

                  return (
                    <div
                      key={key}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span className="size-1 rounded-full bg-foreground/60" />
                      {canNavigate ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChipClick(id, targetCollection);
                          }}
                          className="text-primary hover:underline text-left"
                        >
                          {label}
                        </button>
                      ) : (
                        <span>{label}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </TooltipContent>
          )}
        </Tooltip>

        {/* Detail sheet */}
        {sheetCollection && sheetItemId && (
          <ResourceSheet
            type="collection"
            collection={sheetCollection}
            itemId={sheetItemId}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
          />
        )}
      </>
    );
  }

  // Handle single relation
  return (
    <>
      <RelationChip
        item={value}
        targetCollection={targetCollection}
        onClick={handleChipClick}
      />
      {/* Detail sheet */}
      {sheetCollection && sheetItemId && (
        <ResourceSheet
          type="collection"
          collection={sheetCollection}
          itemId={sheetItemId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      )}
    </>
  );
}

// ============================================================================
// Reverse Relation Cell
// ============================================================================

/**
 * Reverse relation cell - displays related items as clickable chips
 * Shows count badge with tooltip listing all items for navigation
 * Opens detail sheet on click
 */
export function ReverseRelationCell({
  value,
  fieldDef,
}: {
  value: unknown;
  row?: unknown;
  fieldDef?: FieldDefinition;
}) {
  const resolveText = useResolveText();
  // Get source collection from fieldDef (the collection that has the relation pointing here)
  const sourceCollection = fieldDef?.["~options"]?.sourceCollection as
    | string
    | undefined;

  // Sheet state
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [sheetItemId, setSheetItemId] = React.useState<string | undefined>();
  const [sheetCollection, setSheetCollection] = React.useState<
    string | undefined
  >();

  const handleChipClick = React.useCallback(
    (itemId: string, collection: string) => {
      setSheetItemId(itemId);
      setSheetCollection(collection);
      setSheetOpen(true);
    },
    [],
  );

  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">-</span>;
  }

  // Handle count-only value (when items not fetched)
  if (typeof value === "number") {
    return (
      <Badge variant="secondary">
        {value} item{value !== 1 ? "s" : ""}
      </Badge>
    );
  }

  // Handle array of related items
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }

    // For small counts, show chips inline
    if (value.length <= 2) {
      return (
        <>
          <span className="inline-flex flex-wrap items-center gap-1">
            {value.map((item, idx) => (
              <RelationChip
                // biome-ignore lint/suspicious/noArrayIndexKey: stable array from backend
                key={idx}
                item={item}
                targetCollection={sourceCollection}
                onClick={handleChipClick}
              />
            ))}
          </span>
          {/* Detail sheet */}
          {sheetCollection && sheetItemId && (
            <ResourceSheet
              type="collection"
              collection={sheetCollection}
              itemId={sheetItemId}
              open={sheetOpen}
              onOpenChange={setSheetOpen}
            />
          )}
        </>
      );
    }

    // For larger counts, show count badge with tooltip
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 cursor-default",
                  "text-muted-foreground hover:text-foreground transition-colors",
                )}
              >
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {value.length}
                </Badge>
                <span className="text-xs">
                  {resolveText(getRelationItemLabel(value[0]))}
                  {value.length > 1 && ` +${value.length - 1}`}
                </span>
              </span>
            }
          />
          <TooltipContent side="bottom" align="start" className="p-0 w-56">
            <div className="max-h-[200px] overflow-y-auto p-2 space-y-1">
              {value.slice(0, 15).map((item, idx) => {
                const label = resolveText(getRelationItemLabel(item));
                const id = getRelationItemId(item);
                const canNavigate = sourceCollection && id;
                const key = id ?? label ?? `item-${idx}`;

                return (
                  <div key={key} className="flex items-center gap-1.5 text-xs">
                    <span className="size-1 rounded-full bg-foreground/60" />
                    {canNavigate ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleChipClick(id, sourceCollection);
                        }}
                        className="text-primary hover:underline text-left truncate"
                      >
                        {label}
                      </button>
                    ) : (
                      <span className="truncate">{label}</span>
                    )}
                  </div>
                );
              })}
              {value.length > 15 && (
                <div className="text-[11px] text-muted-foreground text-center pt-1 border-t border-border/50 mt-1">
                  +{value.length - 15} more
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>

        {/* Detail sheet */}
        {sheetCollection && sheetItemId && (
          <ResourceSheet
            type="collection"
            collection={sheetCollection}
            itemId={sheetItemId}
            open={sheetOpen}
            onOpenChange={setSheetOpen}
          />
        )}
      </>
    );
  }

  return <span className="text-muted-foreground">-</span>;
}
