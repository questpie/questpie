import { qb } from "@/questpie/server/builder";

export const reviews = qb
  .collection("reviews")
  .fields((f) => ({
    customer: f.relation({ to: "user" }),
    customerName: f.text({ required: true, maxLength: 255 }),
    customerEmail: f.email({ maxLength: 255 }),
    barber: f.relation({ to: "barbers", required: true }),
    appointment: f.relation({ to: "appointments" }),
    rating: f.number({ required: true, min: 1, max: 5 }),
    comment: f.textarea({ localized: true }),
    isApproved: f.boolean({ default: false, required: true }),
    isFeatured: f.boolean({ default: false, required: true }),
  }))
  .title(({ f }) => f.customerName);
