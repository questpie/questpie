/**
 * Layout Blocks
 *
 * Columns, Spacer, Divider for page structure.
 * Design: Minimal utility blocks.
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

// ============================================================================
// COLUMNS
// ============================================================================

type ColumnsValues = {
  columns: "2" | "3" | "4";
  gap: "small" | "medium" | "large";
  padding: "none" | "small" | "medium" | "large";
};

function ColumnsRenderer({
  values,
  children,
}: BlockRendererProps<ColumnsValues>) {
  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "2"];

  const gapClass = {
    small: "gap-4",
    medium: "gap-6 md:gap-8",
    large: "gap-8 md:gap-12",
  }[values.gap || "medium"];

  const paddingClass = {
    none: "py-0",
    small: "py-8",
    medium: "py-16",
    large: "py-24",
  }[values.padding || "medium"];

  return (
    <section className={cn("px-6", paddingClass)}>
      <div className={cn("container grid grid-cols-1", columnsClass, gapClass)}>
        {children}
      </div>
    </section>
  );
}

export const columnsBlock = builder
  .block("columns")
  .label({ en: "Columns", sk: "Stĺpce" })
  .description({
    en: "Multi-column layout",
    sk: "Viacstĺpcové rozloženie",
  })
  .icon("Columns")
  .category("layout")
  .fields(({ r }) => ({
    columns: r.select({
      label: { en: "Columns", sk: "Stĺpce" },
      options: [
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        { value: "4", label: "4" },
      ],
      defaultValue: "2",
    }),
    gap: r.select({
      label: { en: "Gap", sk: "Medzera" },
      options: [
        { value: "small", label: { en: "Small", sk: "Malá" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "large", label: { en: "Large", sk: "Veľká" } },
      ],
      defaultValue: "medium",
    }),
    padding: r.select({
      label: { en: "Padding", sk: "Padding" },
      options: [
        { value: "none", label: { en: "None", sk: "Žiadny" } },
        { value: "small", label: { en: "Small", sk: "Malý" } },
        { value: "medium", label: { en: "Medium", sk: "Stredný" } },
        { value: "large", label: { en: "Large", sk: "Veľký" } },
      ],
      defaultValue: "medium",
    }),
  }))
  .allowChildren(true, { max: 4 })
  .renderer(ColumnsRenderer)
  .build();

// ============================================================================
// SPACER
// ============================================================================

type SpacerValues = {
  size: "small" | "medium" | "large" | "xlarge";
};

function SpacerRenderer({ values }: BlockRendererProps<SpacerValues>) {
  const sizeClass = {
    small: "h-8 md:h-12",
    medium: "h-12 md:h-20",
    large: "h-20 md:h-32",
    xlarge: "h-32 md:h-48",
  }[values.size || "medium"];

  return <div className={sizeClass} aria-hidden="true" />;
}

export const spacerBlock = builder
  .block("spacer")
  .label({ en: "Spacer", sk: "Medzera" })
  .description({
    en: "Vertical space",
    sk: "Vertikálna medzera",
  })
  .icon("ArrowsVertical")
  .category("layout")
  .fields(({ r }) => ({
    size: r.select({
      label: { en: "Size", sk: "Veľkosť" },
      options: [
        { value: "small", label: { en: "Small", sk: "Malá" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "large", label: { en: "Large", sk: "Veľká" } },
        { value: "xlarge", label: { en: "Extra Large", sk: "Extra veľká" } },
      ],
      defaultValue: "medium",
    }),
  }))
  .renderer(SpacerRenderer)
  .build();

// ============================================================================
// DIVIDER
// ============================================================================

type DividerValues = {
  style: "solid" | "dashed";
  width: "full" | "medium" | "small";
};

function DividerRenderer({ values }: BlockRendererProps<DividerValues>) {
  const widthClass = {
    full: "w-full",
    medium: "w-1/2 mx-auto",
    small: "w-24 mx-auto",
  }[values.width || "full"];

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

export const dividerBlock = builder
  .block("divider")
  .label({ en: "Divider", sk: "Oddeľovač" })
  .description({
    en: "Horizontal line",
    sk: "Horizontálna čiara",
  })
  .icon("Minus")
  .category("layout")
  .fields(({ r }) => ({
    style: r.select({
      label: { en: "Style", sk: "Štýl" },
      options: [
        { value: "solid", label: { en: "Solid", sk: "Plná" } },
        { value: "dashed", label: { en: "Dashed", sk: "Prerušovaná" } },
      ],
      defaultValue: "solid",
    }),
    width: r.select({
      label: { en: "Width", sk: "Šírka" },
      options: [
        { value: "full", label: { en: "Full", sk: "Plná" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "small", label: { en: "Small", sk: "Malá" } },
      ],
      defaultValue: "full",
    }),
  }))
  .renderer(DividerRenderer)
  .build();
