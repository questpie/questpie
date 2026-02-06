/**
 * RelationChip Component
 *
 * Clickable chip for displaying relation items.
 * Extracted from RelationCell to eliminate duplication.
 * Used by RelationCell and ReverseRelationCell.
 */

import type * as React from "react";
import { useResolveText } from "../../../../i18n/hooks";
import { cn } from "../../../../lib/utils";
import { getRelationItemId, getRelationItemLabel } from "./cell-helpers";

export interface RelationChipProps {
  /**
   * Relation item (object with id, name, title, etc.)
   */
  item: unknown;

  /**
   * Target collection name for navigation
   */
  targetCollection?: string;

  /**
   * Click handler (if provided, prevents default navigation)
   * Receives item ID and collection name
   */
  onClick?: (itemId: string, collection: string) => void;
}

/**
 * Clickable relation chip component
 * Shows label and navigates to related item on click (or opens sheet if onClick provided)
 */
export function RelationChip({
  item,
  targetCollection,
  onClick,
}: RelationChipProps) {
  const resolveText = useResolveText();
  const label = resolveText(getRelationItemLabel(item));
  const id = getRelationItemId(item);
  const canInteract = targetCollection && id;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick && id && targetCollection) {
      e.preventDefault();
      onClick(id, targetCollection);
    }
  };

  if (canInteract) {
    const href = `/admin/collections/${targetCollection}/${id}`;
    const chipClassName = cn(
      "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs",
      "bg-primary/10 text-primary hover:bg-primary/20",
      "transition-colors cursor-pointer",
      "border border-primary/20 hover:border-primary/40",
    );

    // If onClick provided, use button-like behavior but keep href for accessibility
    return (
      <a
        href={href}
        onClick={handleClick}
        onPointerDown={(e) => e.stopPropagation()}
        className={chipClassName}
      >
        {label}
      </a>
    );
  }

  // Non-clickable chip (no target collection or id)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs",
        "bg-muted text-muted-foreground",
        "border border-border",
      )}
    >
      {label}
    </span>
  );
}
