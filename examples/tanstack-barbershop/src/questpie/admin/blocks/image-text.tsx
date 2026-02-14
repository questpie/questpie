/**
 * Image-Text Block
 *
 * Image and text content side by side.
 * Design: Flexible layout with image on left or right.
 *
 * The `image` upload field is expanded via `.prefetch({ with: ['image'] })`.
 */

import {  RichTextRenderer,
  type TipTapDoc } from "@questpie/admin/client";
import type { BlockProps } from "./types";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

export function ImageTextRenderer({
  values,
  data }: BlockProps<"image-text">) {
  const imageUrl = (data?.image?.url as string | undefined) || values.image;

  const aspectClass = {
    square: "aspect-square",
    portrait: "aspect-[3/4]",
    landscape: "aspect-[4/3]" }[values.imageAspect || "square"];

  const isImageRight = values.imagePosition === "right";
  const richTextStyles = {
    doc: "max-w-none",
    paragraph: "text-muted-foreground leading-relaxed mb-4 last:mb-0",
    link: "text-highlight no-underline hover:underline",
    strong: "text-foreground font-semibold",
    blockquote: "border-l-highlight text-muted-foreground" };

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

