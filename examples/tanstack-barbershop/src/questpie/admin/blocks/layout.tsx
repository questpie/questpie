/**
 * Layout Blocks
 *
 * Columns, Spacer, Divider for page structure.
 * Design: Minimal utility blocks.
 */

import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

// ============================================================================
// COLUMNS
// ============================================================================

export function ColumnsRenderer({
  values,
  children }: BlockProps<"columns">) {
  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "2"];

  const gapClass = {
    small: "gap-4",
    medium: "gap-6 md:gap-8",
    large: "gap-8 md:gap-12" }[values.gap || "medium"];

  const paddingClass = {
    none: "py-0",
    small: "py-8",
    medium: "py-16",
    large: "py-24" }[values.padding || "medium"];

  return (
    <section className={cn("px-6", paddingClass)}>
      <div className={cn("container grid grid-cols-1", columnsClass, gapClass)}>
        {children}
      </div>
    </section>
  );
}

// ============================================================================
// SPACER
// ============================================================================

export function SpacerRenderer({ values }: BlockProps<"spacer">) {
  const sizeClass = {
    small: "h-8 md:h-12",
    medium: "h-12 md:h-20",
    large: "h-20 md:h-32",
    xlarge: "h-32 md:h-48" }[values.size || "medium"];

  return <div className={sizeClass} aria-hidden="true" />;
}

// ============================================================================
// DIVIDER
// ============================================================================

export function DividerRenderer({ values }: BlockProps<"divider">) {
  const widthClass = {
    full: "w-full",
    medium: "w-1/2 mx-auto",
    small: "w-24 mx-auto" }[values.width || "full"];

  return (
    <div className="py-8 px-6">
      <hr
        className={cn(
          "border-t border-border",
          widthClass,
          values.style === "dashed" && "border-dashed",
        )}
      />
    </div>
  );
}

