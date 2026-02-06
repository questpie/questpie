import { qb } from "@/questpie/server/builder";

/**
 * Reviews Collection
 *
 * Customer reviews and testimonials.
 * Features:
 * - Rating (1-5 stars)
 * - Localized comment field
 * - Moderation (isApproved)
 * - Featured reviews for homepage
 */
export const reviews = qb
  .collection("reviews")
  .fields((f) => ({
    // Customer info (can be from user or anonymous)
    customer: f.relation({ to: "user" }),
    customerName: f.text({ required: true, maxLength: 255 }),
    customerEmail: f.email({ maxLength: 255 }),

    // Review target
    barber: f.relation({ to: "barbers", required: true }),
    appointment: f.relation({ to: "appointments" }),

    // Review content
    rating: f.number({ required: true, min: 1, max: 5 }),
    comment: f.textarea({ localized: true }),

    // Moderation
    isApproved: f.boolean({ default: false, required: true }),
    isFeatured: f.boolean({ default: false, required: true }),
  }))
  .title(({ f }) => f.customerName);
