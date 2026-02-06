import { qb } from "@/questpie/server/builder";

/**
 * Services Collection
 *
 * Demonstrates localized fields - name and description are stored
 * in a separate _i18n table for multi-language support.
 */
export const services = qb
  .collection("services")
  .fields((f) => ({
    // These fields will be localized (stored in services_i18n table)
    name: f.text({ required: true, maxLength: 255, localized: true }),
    description: f.textarea({ localized: true }),
    // Non-localized fields (stored in services table)
    image: f.upload({ to: "assets" }),
    duration: f.number({ required: true }), // in minutes
    price: f.number({ required: true }), // in cents
    isActive: f.boolean({ default: true, required: true }),
    barbers: f.relation({
      to: "barbers",
      hasMany: true,
      through: "barber_services",
      sourceField: "service",
      targetField: "barber",
    }),
  }))
  .title(({ f }) => f.name);
