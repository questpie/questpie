/**
 * Text Block
 *
 * Rich text content with prose styling.
 * Design: Clean typography with proper spacing.
 */

import {
  type BlockRendererProps,
  RichTextRenderer,
  type TipTapDoc,
} from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type TextValues = {
  content: TipTapDoc | null;
  maxWidth: "narrow" | "medium" | "wide" | "full";
  padding: "none" | "small" | "medium" | "large";
};

function TextRenderer({ values }: BlockRendererProps<TextValues>) {
  const maxWidthClass = {
    narrow: "max-w-xl",
    medium: "max-w-3xl",
    wide: "max-w-5xl",
    full: "max-w-none",
  }[values.maxWidth || "medium"];

  const paddingClass = {
    none: "py-0",
    small: "py-8",
    medium: "py-16",
    large: "py-24",
  }[values.padding || "medium"];

  const richTextStyles = {
    doc: cn("max-w-none", maxWidthClass),
    paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
    heading1: "text-3xl font-bold tracking-tight mb-4",
    heading2: "text-2xl font-bold tracking-tight mb-3",
    heading3: "text-xl font-semibold tracking-tight mb-3",
    heading4: "text-lg font-semibold tracking-tight mb-2",
    heading5: "text-base font-semibold tracking-tight mb-2",
    heading6: "text-sm font-semibold tracking-tight mb-2",
    link: "text-highlight no-underline hover:underline",
    strong: "text-foreground font-semibold",
    blockquote: "border-l-highlight text-muted-foreground",
  };

  return (
    <section className={cn("px-6", paddingClass)}>
      <div
        className={cn(
          "mx-auto prose prose-neutral dark:prose-invert",
          "prose-headings:font-bold prose-headings:tracking-tight",
          "prose-p:text-muted-foreground prose-p:leading-relaxed",
          "prose-a:text-highlight prose-a:no-underline hover:prose-a:underline",
          "prose-strong:text-foreground prose-strong:font-semibold",
          "prose-blockquote:border-l-highlight prose-blockquote:text-muted-foreground",
        )}
      >
        <RichTextRenderer content={values.content} styles={richTextStyles} />
      </div>
    </section>
  );
}

export const textBlock = builder
  .block("text")
  .label({ en: "Text", sk: "Text" })
  .description({
    en: "Rich text content",
    sk: "Formátovaný text",
  })
  .icon("TextAa")
  .category("content")
  .fields(({ r }) => ({
    content: r.richText({
      label: { en: "Content", sk: "Obsah" },
      localized: true,
    }),
    maxWidth: r.select({
      label: { en: "Max Width", sk: "Max šírka" },
      options: [
        { value: "narrow", label: { en: "Narrow", sk: "Úzka" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "wide", label: { en: "Wide", sk: "Široká" } },
        { value: "full", label: { en: "Full", sk: "Plná" } },
      ],
      defaultValue: "medium",
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
  .renderer(TextRenderer)
  .build();
