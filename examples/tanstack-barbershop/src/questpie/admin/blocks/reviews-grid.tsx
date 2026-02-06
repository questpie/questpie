/**
 * Reviews Grid Block
 *
 * Customer testimonials in a static grid layout (no carousel).
 * Design: Clean grid with ratings and quotes.
 */

import { Quotes, Star } from "@phosphor-icons/react";
import type { BlockRendererProps } from "@questpie/admin/client";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  customerName: string | null;
  createdAt: string;
};

type ReviewsGridValues = {
  title: string;
  subtitle?: string;
  filter: "featured" | "recent" | "all";
  limit: number;
  columns: "2" | "3" | "4";
};

function ReviewsGridRenderer({
  values,
  data,
}: BlockRendererProps<ReviewsGridValues>) {
  const { reviews = [] } = (data as { reviews: Review[] }) || {};

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4",
  }[values.columns || "3"];

  return (
    <section className="py-20 px-6">
      <div className="container">
        {/* Header */}
        {(values.title || values.subtitle) && (
          <div className="text-center mb-16 max-w-2xl mx-auto">
            {values.title && (
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
                {values.title}
              </h2>
            )}
            {values.subtitle && (
              <p className="text-lg text-muted-foreground">{values.subtitle}</p>
            )}
          </div>
        )}

        {/* Reviews Grid */}
        <div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
          {reviews.map((review, i) => (
            <article
              key={review.id}
              className="bg-card border rounded-lg p-6 hover:shadow-lg transition-shadow"
            >
              {/* Quote Icon */}
              <Quotes className="size-8 text-highlight/20 mb-4" weight="fill" />

              {/* Rating */}
              <div className="flex items-center gap-1 mb-4">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    weight={star <= review.rating ? "fill" : "regular"}
                    className={cn(
                      "size-5",
                      star <= review.rating
                        ? "text-yellow-400"
                        : "text-muted-foreground/30",
                    )}
                  />
                ))}
              </div>

              {/* Comment */}
              {review.comment && (
                <p className="text-muted-foreground leading-relaxed mb-4">
                  "{review.comment}"
                </p>
              )}

              {/* Customer */}
              <div className="pt-4 border-t">
                <span className="font-medium text-sm">
                  {review.customerName || "Anonymous"}
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export const reviewsGridBlock = builder
  .block("reviews-grid")
  .label({ en: "Reviews Grid", sk: "Recenzie mriežka" })
  .description({
    en: "Customer reviews in grid layout",
    sk: "Recenzie zákazníkov v mriežke",
  })
  .icon("ChatCircleDots")
  .category("content")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Nadpis" },
      required: true,
      localized: true,
      defaultValue: { en: "What Our Clients Say", sk: "Čo hovoria klienti" },
    }),
    subtitle: r.text({
      label: { en: "Subtitle", sk: "Podnadpis" },
      localized: true,
    }),
    filter: r.select({
      label: { en: "Show Reviews", sk: "Zobraziť recenzie" },
      options: [
        {
          value: "featured",
          label: { en: "Featured Only", sk: "Iba vybrané" },
        },
        { value: "recent", label: { en: "Most Recent", sk: "Najnovšie" } },
        { value: "all", label: { en: "All Approved", sk: "Všetky schválené" } },
      ],
      defaultValue: "featured",
    }),
    limit: r.number({
      label: { en: "Maximum Reviews", sk: "Maximum recenzií" },
      min: 1,
      max: 12,
      defaultValue: 6,
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
  }))
  .renderer(ReviewsGridRenderer)
  .build();
