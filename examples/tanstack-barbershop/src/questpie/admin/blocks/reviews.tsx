/**
 * Reviews Block
 *
 * Customer testimonials with ratings.
 * Design: Quote-style cards with star ratings.
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

type ReviewsValues = {
  title: string;
  subtitle: string;
  limit: number;
};

function ReviewsRenderer({ values, data }: BlockRendererProps<ReviewsValues>) {
  const { reviews = [] } = (data as { reviews: Review[] }) || {};

  return (
    <section className="py-20 px-6 bg-muted/30">
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {reviews.map((review, i) => (
            <article
              key={review.id}
              className="bg-card border border-border p-8 animate-fade-in-up"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              {/* Quote Icon */}
              <Quotes
                className="size-10 text-highlight/20 mb-4"
                weight="fill"
              />

              {/* Comment */}
              {review.comment && (
                <p className="text-foreground leading-relaxed mb-6 line-clamp-4">
                  "{review.comment}"
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <span className="font-medium text-sm">
                  {review.customerName || "Anonymous"}
                </span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      weight={star <= review.rating ? "fill" : "regular"}
                      className={cn(
                        "size-4",
                        star <= review.rating
                          ? "text-highlight"
                          : "text-muted-foreground/30",
                      )}
                    />
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>

        {reviews.length === 0 && (
          <p className="text-center text-muted-foreground py-12">
            No reviews yet
          </p>
        )}
      </div>
    </section>
  );
}

export const reviewsBlock = builder
  .block("reviews")
  .label({ en: "Reviews", sk: "Recenzie" })
  .description({
    en: "Display customer testimonials",
    sk: "Zobrazenie recenzií zákazníkov",
  })
  .icon("Star")
  .category("sections")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Titulok" },
      localized: true,
    }),
    subtitle: r.textarea({
      label: { en: "Subtitle", sk: "Podtitulok" },
      localized: true,
    }),
    limit: r.number({
      label: { en: "Max Reviews", sk: "Max recenzií" },
      defaultValue: 6,
      min: 1,
      max: 12,
    }),
  }))
  .renderer(ReviewsRenderer)
  .build();
