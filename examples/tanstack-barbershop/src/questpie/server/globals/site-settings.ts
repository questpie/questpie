/**
 * Site Settings Global
 *
 * Singleton configuration for the barbershop site.
 * Features:
 * - Basic shop info (name, tagline, logo)
 * - Navigation (header nav items, localized)
 * - Footer configuration (links, localized)
 * - Contact details
 * - Business hours
 * - Booking configuration
 * - Social media links
 * - SEO settings
 *
 * Note: Hero and page content are managed via Pages collection with blocks!
 */

import { qb } from "@/questpie/server/builder";
import type { WorkingHours } from "../collections/barbers";

/**
 * Navigation item type (for header navigation)
 */
export type NavItem = {
  label: string;
  href: string;
  isExternal?: boolean;
};

/**
 * Footer link type
 */
export type FooterLink = {
  label: string;
  href: string;
  isExternal?: boolean;
};

/**
 * Social media link type
 */
export type SocialLink = {
  platform: "instagram" | "facebook" | "twitter" | "tiktok" | "youtube";
  url: string;
};

/**
 * Booking settings type
 */
export type BookingSettings = {
  minAdvanceHours: number;
  maxAdvanceDays: number;
  slotDurationMinutes: number;
  allowCancellation: boolean;
  cancellationDeadlineHours: number;
};

export const siteSettings = qb
  .global("site_settings")
  .fields((f) => ({
    // === Branding ===
    shopName: f.text({ required: true, default: "Sharp Cuts" }),
    tagline: f.text({ default: "Your Style, Our Passion", localized: true }),
    logo: f.upload({ to: "assets" }),

    // === Navigation (Header) ===
    navigation: f.array({
      localized: true,
      default: [
        { label: "Home", href: "/" },
        { label: "Services", href: "/services" },
        { label: "Our Team", href: "/barbers" },
        { label: "Contact", href: "/contact" },
      ] satisfies NavItem[],
      of: f.object({
        fields: {
          label: f.text({ required: true }),
          href: f.text({ required: true }),
          isExternal: f.boolean({ default: false }),
        },
      }),
    }),
    ctaButtonText: f.text({ default: "Book Now", localized: true }),
    ctaButtonLink: f.text({ default: "/booking" }),

    // === Footer ===
    footerTagline: f.text({
      default: "Your Style, Our Passion",
      localized: true,
    }),
    footerLinks: f.array({
      localized: true,
      default: [
        { label: "Services", href: "/services" },
        { label: "Our Team", href: "/barbers" },
        { label: "Contact", href: "/contact" },
        { label: "Privacy Policy", href: "/privacy" },
      ] satisfies FooterLink[],
      of: f.object({
        fields: {
          label: f.text({ required: true }),
          href: f.text({ required: true }),
          isExternal: f.boolean({ default: false }),
        },
      }),
    }),
    copyrightText: f.text({
      default: "Sharp Cuts. All rights reserved.",
      localized: true,
    }),

    // === Contact ===
    contactEmail: f.email({ required: true, default: "hello@barbershop.com" }),
    contactPhone: f.text({ default: "+1 555 0100" }),
    address: f.text({ default: "123 Main Street" }),
    city: f.text({ default: "New York" }),
    zipCode: f.text({ default: "10001" }),
    country: f.text({ default: "USA" }),
    mapEmbedUrl: f.text(),

    // === Business Settings ===
    isOpen: f.boolean({ default: true, required: true }),
    bookingEnabled: f.boolean({ default: true, required: true }),

    // === Working Hours (shop-wide defaults) ===
    businessHours: f.object({
      default: {
        monday: { isOpen: true, start: "09:00", end: "18:00" },
        tuesday: { isOpen: true, start: "09:00", end: "18:00" },
        wednesday: { isOpen: true, start: "09:00", end: "18:00" },
        thursday: { isOpen: true, start: "09:00", end: "20:00" },
        friday: { isOpen: true, start: "09:00", end: "20:00" },
        saturday: { isOpen: true, start: "10:00", end: "16:00" },
        sunday: { isOpen: false, start: "", end: "" },
      } satisfies WorkingHours,
      fields: {
        monday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        tuesday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        wednesday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        thursday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        friday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        saturday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
        sunday: f.object({
          fields: {
            isOpen: f.boolean({ default: true, required: true }),
            start: f.time({}),
            end: f.time({}),
          },
        }),
      },
    }),

    // === Booking Configuration ===
    bookingSettings: f.object({
      default: {
        minAdvanceHours: 2,
        maxAdvanceDays: 30,
        slotDurationMinutes: 30,
        allowCancellation: true,
        cancellationDeadlineHours: 24,
      } satisfies BookingSettings,
      fields: {
        minAdvanceHours: f.number({ required: true }),
        maxAdvanceDays: f.number({ required: true }),
        slotDurationMinutes: f.number({ required: true }),
        allowCancellation: f.boolean({ required: true }),
        cancellationDeadlineHours: f.number({ required: true }),
      },
    }),

    // === Social Media ===
    socialLinks: f.array({
      default: [
        { platform: "instagram", url: "https://instagram.com/sharpcuts" },
        { platform: "facebook", url: "https://facebook.com/sharpcuts" },
      ] satisfies SocialLink[],
      of: f.object({
        fields: {
          platform: f.select({
            options: [
              { value: "instagram", label: "Instagram" },
              { value: "facebook", label: "Facebook" },
              { value: "twitter", label: "Twitter" },
              { value: "tiktok", label: "TikTok" },
              { value: "youtube", label: "YouTube" },
            ],
            required: true,
          }),
          url: f.url({ required: true }),
        },
      }),
    }),

    // === SEO ===
    metaTitle: f.text({
      default: "Sharp Cuts - Premium Barbershop",
      localized: true,
    }),
    metaDescription: f.textarea({
      default:
        "Professional barbershop services - haircuts, beard grooming, and more.",
      localized: true,
    }),
  }))
  .options({
    timestamps: true,
    versioning: true,
  })
  .access({
    read: true, // Anyone can read
    update: "admin", // Only admins can update
  })
  .build();
