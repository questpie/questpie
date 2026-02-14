/**
 * Gallery Block
 *
 * Image gallery with grid layout.
 * Design: Responsive masonry-style grid with lightbox support.
 */

import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

export function GalleryRenderer({ values, data }: BlockProps<"gallery">) {
  const imageUrls = data?.imageUrls as Record<string, string> | undefined ?? {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "3"];

  const gapClass = {
    small: "gap-2",
    medium: "gap-4",
    large: "gap-8" }[values.gap || "medium"];

  return (
    <section className="py-20 px-6">
      <div className="container">
        {values.title && (
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-12 text-center">
            {values.title}
          </h2>
        )}

        <div className={cn("grid grid-cols-1", columnsClass, gapClass)}>
          {values.images?.map((imageId) => {
            const url = imageUrls[imageId];
            return (
              <figure
                key={imageId}
                className="group relative overflow-hidden rounded-lg bg-muted aspect-square cursor-pointer hover:shadow-lg transition-all"
              >
                {url ? (
                  <img
                    src={url}
                    alt=""
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                    No image
                  </div>
                )}
              </figure>
            );
          })}
        </div>
      </div>
    </section>
  );
}
