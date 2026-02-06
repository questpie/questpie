/**
 * Heading Block
 *
 * Customizable heading (h1-h4) with alignment and styling options.
 * Design: Bold typography with consistent spacing.
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type HeadingValues = {
  text: string;
  level: "h1" | "h2" | "h3" | "h4";
  align: "left" | "center" | "right";
  padding: "none" | "small" | "medium" | "large";
};

function HeadingRenderer({ values }: BlockRendererProps<HeadingValues>) {
  const Tag = values.level || "h2";

  const sizeClass = {
    h1: "text-5xl md:text-6xl lg:text-7xl",
    h2: "text-4xl md:text-5xl lg:text-6xl",
    h3: "text-3xl md:text-4xl lg:text-5xl",
    h4: "text-2xl md:text-3xl lg:text-4xl",
  }[Tag];

  const alignClass = {
    left: "text-left",
    center: "text-center",
    right: "text-right",
  }[values.align || "left"];

  const paddingClass = {
    none: "py-0",
    small: "py-4",
    medium: "py-8",
    large: "py-12",
  }[values.padding || "medium"];

  return (
    <section className={cn("px-6", paddingClass)}>
      <Tag
        className={cn(
          "font-bold tracking-tight",
          "text-foreground",
          sizeClass,
          alignClass,
        )}
      >
        {values.text || "Heading"}
      </Tag>
    </section>
  );
}

export const headingBlock = builder
  .block("heading")
  .label({ en: "Heading", sk: "Nadpis" })
  .description({
    en: "Customizable heading (h1-h4)",
    sk: "Prispôsobiteľný nadpis (h1-h4)",
  })
  .icon("TextT")
  .category("content")
  .fields(({ r }) => ({
    text: r.text({
      label: { en: "Text", sk: "Text" },
      required: true,
      localized: true,
    }),
    level: r.select({
      label: { en: "Heading Level", sk: "Úroveň nadpisu" },
      options: [
        { value: "h1", label: { en: "H1 (Largest)", sk: "H1 (Najväčší)" } },
        { value: "h2", label: { en: "H2 (Large)", sk: "H2 (Veľký)" } },
        { value: "h3", label: { en: "H3 (Medium)", sk: "H3 (Stredný)" } },
        { value: "h4", label: { en: "H4 (Small)", sk: "H4 (Malý)" } },
      ],
      defaultValue: "h2",
    }),
    align: r.select({
      label: { en: "Alignment", sk: "Zarovnanie" },
      options: [
        { value: "left", label: { en: "Left", sk: "Vľavo" } },
        { value: "center", label: { en: "Center", sk: "Na stred" } },
        { value: "right", label: { en: "Right", sk: "Vpravo" } },
      ],
      defaultValue: "left",
    }),
    padding: r.select({
      label: { en: "Vertical Padding", sk: "Vertikálny padding" },
      options: [
        { value: "none", label: { en: "None", sk: "Žiadny" } },
        { value: "small", label: { en: "Small", sk: "Malý" } },
        { value: "medium", label: { en: "Medium", sk: "Stredný" } },
        { value: "large", label: { en: "Large", sk: "Veľký" } },
      ],
      defaultValue: "medium",
    }),
  }))
  .renderer(HeadingRenderer)
  .build();
