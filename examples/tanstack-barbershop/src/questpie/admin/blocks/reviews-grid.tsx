/**
 * Reviews Grid Block
 *
 * Customer testimonials in a static grid layout (no carousel).
 * Design: Clean grid with ratings and quotes.
 */

import { Quotes, Star } from "@phosphor-icons/react";
import type { BlockProps } from "./types";
import { cn } from "../../../lib/utils";

type Review = {
  id: string;
  rating: number;
  comment: string | null;
  customerName: string | null;
  createdAt: string;
};

export function ReviewsGridRenderer({
  values,
  data }: BlockProps<"reviews-grid">) {
  const reviews = (data?.reviews ?? []) as Review[];

  const columnsClass = {
    "2": "md:grid-cols-2",
    "3": "md:grid-cols-2 lg:grid-cols-3",
    "4": "md:grid-cols-2 lg:grid-cols-4" }[values.columns || "3"];

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

