/**
 * Table Display - table with columns
 *
 * Uses the same cell components as TableView for consistent rendering.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { CollectionEditLink } from "../../../admin-link";
import { Button } from "../../../ui/button";
import {
  formatColumnHeader,
  type RelationDisplayProps,
  resolveCellForColumn,
} from "./types";

/**
 * Cell renderer that uses resolved cell components from field registry
 */
function CellRenderer({
  item,
  column,
  collectionConfig,
}: {
  item: any;
  column: string;
  collectionConfig?: RelationDisplayProps["collectionConfig"];
}) {
  const resolved = React.useMemo(
    () => resolveCellForColumn(column, collectionConfig),
    [column, collectionConfig],
  );

  const value = item[resolved.accessorKey];
  const { component: CellComponent, fieldDef, needsFieldDef } = resolved;

  if (needsFieldDef) {
    return <CellComponent value={value} row={item} fieldDef={fieldDef} />;
  }

  return <CellComponent value={value} row={item} />;
}

export function TableDisplay({
  items,
  collection,
  actions,
  editable = false,
  columns = ["_title"],
  linkToDetail = false,
  collectionConfig,
}: RelationDisplayProps) {
  const hasActions = editable || linkToDetail || actions?.onEdit;

  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 bg-card/10 backdrop-blur-sm">
            {columns.map((col) => (
              <th key={col} className="px-3 py-2 text-left font-medium">
                {formatColumnHeader(col)}
              </th>
            ))}
            {hasActions && <th className="px-3 py-2 w-20" />}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b last:border-0">
              {columns.map((col) => (
                <td key={col} className="px-3 py-2">
                  <CellRenderer
                    item={item}
                    column={col}
                    collectionConfig={collectionConfig}
                  />
                </td>
              ))}
              {hasActions && (
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    {/* Edit button */}
                    {actions?.onEdit && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => actions.onEdit?.(item)}
                        aria-label="Edit item"
                      >
                        <Icon icon="ph:pencil" className="size-4" />
                      </Button>
                    )}

                    {/* Remove button (editable mode) */}
                    {editable && actions?.onRemove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => actions.onRemove?.(item)}
                        aria-label="Remove item"
                      >
                        <Icon icon="ph:x" className="size-4" />
                      </Button>
                    )}

                    {/* Link to detail (non-editable mode) */}
                    {!editable && linkToDetail && !actions?.onEdit && (
                      <CollectionEditLink
                        collection={collection as any}
                        id={item.id}
                        className="text-primary hover:underline"
                      >
                        <Icon icon="ph:arrow-right" className="size-4" />
                      </CollectionEditLink>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
