/**
 * Image-Text Block
 *
 * Image and text content side by side.
 * Design: Flexible layout with image on left or right.
 */

import {
  type BlockRendererProps,
  RichTextRenderer,
  type TipTapDoc,
} from "@questpie/admin/client";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type ImageTextValues = {
  image: string;
  imagePosition: "left" | "right";
  title: string;
  content: TipTapDoc | null;
  ctaText?: string;
  ctaLink?: string;
  imageAspect: "square" | "portrait" | "landscape";
};

type ImageTextPrefetchedData = {
  imageUrl?: string;
};

function ImageTextRenderer({
  values,
  data,
}: BlockRendererProps<ImageTextValues>) {
  const imageData = (data as ImageTextPrefetchedData) || {};
  const imageUrl = imageData?.imageUrl || values.image;

  const aspectClass = {
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    landscape: "aspect-[4/3]",
  }[values.imageAspect || "square"];

  const isImageRight = values.imagePosition === "right";
  const richTextStyles = {
    doc: "max-w-none",
    paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
    link: "text-highlight no-underline hover:underline",
    strong: "text-foreground font-semibold",
    blockquote: "border-l-highlight text-muted-foreground",
  };

  return (
    <section className="py-20 px-6">
      <div className="container">
        <div
          className={cn(
            "grid grid-cols-1 lg:grid-cols-2 gap-12 items-center",
            isImageRight && "lg:grid-flow-dense",
          )}
        >
          {/* Image */}
          <div
            className={cn(
              "overflow-hidden rounded-lg",
              isImageRight && "lg:col-start-2",
            )}
          >
            <div className={cn("bg-muted", aspectClass)}>
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={values.title || ""}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  No image
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className={cn(isImageRight && "lg:col-start-1 lg:row-start-1")}>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-6">
              {values.title || "Title"}
            </h2>
            <div className="prose prose-neutral dark:prose-invert max-w-none mb-6">
              <RichTextRenderer
                content={values.content}
                styles={richTextStyles}
              />
            </div>
            {values.ctaText && values.ctaLink && (
              <a
                href={values.ctaLink}
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "text-base font-semibold",
                )}
              >
                {values.ctaText}
              </a>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

export const imageTextBlock = builder
  .block("image-text")
  .label({ en: "Image + Text", sk: "Obrázok + Text" })
  .description({
    en: "Image and text side by side",
    sk: "Obrázok a text vedľa seba",
  })
  .icon("ImageSquare")
  .category("content")
  .fields(({ r }) => ({
    image: r.upload({
      label: { en: "Image", sk: "Obrázok" },
      required: true,
    }),
    imagePosition: r.select({
      label: { en: "Image Position", sk: "Pozícia obrázku" },
      options: [
        { value: "left", label: { en: "Left", sk: "Vľavo" } },
        { value: "right", label: { en: "Right", sk: "Vpravo" } },
      ],
      defaultValue: "left",
    }),
    imageAspect: r.select({
      label: { en: "Image Aspect Ratio", sk: "Pomer strán obrázku" },
      options: [
        { value: "square", label: { en: "Square (1:1)", sk: "Štvorec (1:1)" } },
        {
          value: "portrait",
          label: { en: "Portrait (3:4)", sk: "Portrét (3:4)" },
        },
        {
          value: "landscape",
          label: { en: "Landscape (4:3)", sk: "Krajina (4:3)" },
        },
      ],
      defaultValue: "square",
    }),
    title: r.text({
      label: { en: "Title", sk: "Nadpis" },
      required: true,
      localized: true,
    }),
    content: r.richText({
      label: { en: "Content", sk: "Obsah" },
      required: true,
      localized: true,
    }),
    ctaText: r.text({
      label: { en: "Button Text (optional)", sk: "Text tlačidla (voliteľné)" },
      localized: true,
    }),
    ctaLink: r.text({
      label: { en: "Button Link (optional)", sk: "Link tlačidla (voliteľný)" },
    }),
  }))
  .renderer(ImageTextRenderer)
  .build();
