/**
 * Gallery Block
 *
 * Image gallery with grid layout.
 * Design: Responsive masonry-style grid with lightbox support.
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type GalleryImage = {
  id: string;
  caption?: string;
};

type GalleryValues = {
  title?: string;
  images: GalleryImage[];
  columns: "2" | "3" | "4";
  gap: "small" | "medium" | "large";
};

type GalleryPrefetchedData = {
  imageUrls: Record<string, string>;
};

function GalleryRenderer({ values, data }: BlockRendererProps<GalleryValues>) {
  const galleryData = (data as GalleryPrefetchedData) || {};
  const imageUrls = galleryData?.imageUrls || {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

  const gapClass = {
    small: "gap-2",
    medium: "gap-4",
    large: "gap-8",
  }[values.gap || "medium"];

  return (
    <section className="py-20 px-6">
      <div className="container">
        {values.title && (
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-12 text-center">
            {values.title}
          </h2>
        )}

        <div className={cn("grid grid-cols-1", columnsClass, gapClass)}>
          {values.images?.map((image) => {
            const url = imageUrls[image.id];
            return (
              <figure
                key={image.id}
                className="group relative overflow-hidden rounded-lg bg-muted aspect-square cursor-pointer hover:shadow-lg transition-all"
              >
                {url ? (
                  <img
                    src={url}
                    alt={image.caption || ""}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No image
                  </div>
                )}
                {image.caption && (
                  <figcaption className="absolute bottom-0 left-0 right-0 bg-black/60 text-white p-3 text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    {image.caption}
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export const galleryBlock = builder
  .block("gallery")
  .label({ en: "Gallery", sk: "Galéria" })
  .description({
    en: "Image gallery grid",
    sk: "Galéria obrázkov",
  })
  .icon("Images")
  .category("content")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title (optional)", sk: "Nadpis (voliteľný)" },
      localized: true,
    }),
    images: r.array({
      label: { en: "Images", sk: "Obrázky" },
      item: ({ r }) => ({
        id: r.upload({
          label: { en: "Image", sk: "Obrázok" },
          required: true,
        }),
        caption: r.text({
          label: { en: "Caption (optional)", sk: "Popisok (voliteľný)" },
          localized: true,
        }),
      }),
    }),
    columns: r.select({
      label: { en: "Columns", sk: "Stĺpce" },
      options: [
        { value: "2", label: { en: "2 columns", sk: "2 stĺpce" } },
        { value: "3", label: { en: "3 columns", sk: "3 stĺpce" } },
        { value: "4", label: { en: "4 columns", sk: "4 stĺpce" } },
      ],
      defaultValue: "3",
    }),
    gap: r.select({
      label: { en: "Gap Size", sk: "Veľkosť medzery" },
      options: [
        { value: "small", label: { en: "Small", sk: "Malá" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "large", label: { en: "Large", sk: "Veľká" } },
      ],
      defaultValue: "medium",
    }),
  }))
  .renderer(GalleryRenderer)
  .build();
