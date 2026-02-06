/**
 * Cards Display - card grid with image, title, subtitle, meta
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useResolveText } from "../../../../i18n/hooks";
import { CollectionEditLink } from "../../../admin-link";
import { Button } from "../../../ui/button";
import {
  formatCellValue,
  formatColumnHeader,
  getImageUrl,
  getItemDisplayValue,
  type RelationDisplayProps,
} from "./types";

export function CardsDisplay({
  items,
  collection,
  actions,
  editable = false,
  fields,
  gridColumns = 2,
  linkToDetail = false,
}: RelationDisplayProps) {
  const resolveText = useResolveText();
  const getTitle = (item: any) =>
    item[fields?.title || "_title"] || getItemDisplayValue(item);
  const getSubtitle = (item: any) =>
    fields?.subtitle ? item[fields.subtitle] : null;
  const getImage = (item: any) => getImageUrl(item, fields?.image);
  const getMeta = (item: any) => {
    if (!fields?.meta?.length) return [];
    return fields.meta
      .map((field) => ({
        label: formatColumnHeader(field),
        value: formatCellValue(item[field]),
      }))
      .filter((m) => m.value !== "-");
  };

  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={`grid gap-4 ${gridCols[gridColumns]}`}>
      {items.map((item) => {
        const image = getImage(item);
        const subtitle = getSubtitle(item);
        const meta = getMeta(item);

        const cardContent = (
          <div className="rounded-lg border border-border/60 bg-card/30 backdrop-blur-sm hover:bg-card/50 transition-colors overflow-hidden h-full">
            {image && (
              <div className="aspect-video bg-muted">
                <img
                  src={image}
                  alt={getTitle(item)}
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{getTitle(item)}</div>
                  {subtitle && (
                    <div className="text-sm text-muted-foreground truncate mt-0.5">
                      {subtitle}
                    </div>
                  )}
                </div>
                {/* Action buttons for editable mode */}
                {editable && (actions?.onEdit || actions?.onRemove) && (
                  <div className="flex items-center gap-1 shrink-0">
                    {actions?.onEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          actions.onEdit?.(item);
                        }}
                        aria-label="Edit item"
                      >
                        <Icon icon="ph:pencil" className="size-3" />
                      </Button>
                    )}
                    {actions?.onRemove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          actions.onRemove?.(item);
                        }}
                        aria-label="Remove item"
                      >
                        <Icon icon="ph:x" className="size-3" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {meta.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-muted-foreground">
                  {meta.map((m) => (
                    <span key={String(m.label)}>
                      <span className="font-medium">
                        {resolveText(m.label)}:
                      </span>
                      {m.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );

        // Non-editable with sheet edit
        if (!editable && actions?.onEdit) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => actions.onEdit?.(item)}
              className="text-left w-full"
            >
              {cardContent}
            </button>
          );
        }

        // Non-editable with link to detail
        if (!editable && linkToDetail) {
          return (
            <CollectionEditLink
              key={item.id}
              collection={collection as any}
              id={item.id}
              className="block"
            >
              {cardContent}
            </CollectionEditLink>
          );
        }

        // Editable or read-only
        return <div key={item.id}>{cardContent}</div>;
      })}
    </div>
  );
}
