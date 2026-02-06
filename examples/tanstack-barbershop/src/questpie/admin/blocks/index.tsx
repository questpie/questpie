/**
 * Blocks Index
 *
 * Exports all block definitions for the barbershop.
 * Organized by category:
 * - Sections: hero, services, team, reviews, cta, booking-cta
 * - Content: text, heading, image-text, stats, hours, contact-info, gallery
 * - Layout: columns, spacer, divider
 */

// Section blocks
export { heroBlock } from "./hero";
export { servicesBlock } from "./services";
export { servicesFeaturedBlock } from "./services-featured";
export { teamBlock } from "./team";
export { barbersFeaturedBlock } from "./barbers-featured";
export { reviewsBlock } from "./reviews";
export { reviewsGridBlock } from "./reviews-grid";
export { ctaBlock } from "./cta";
export { bookingCtaBlock } from "./booking-cta";

// Content blocks
export { textBlock } from "./text";
export { headingBlock } from "./heading";
export { imageTextBlock } from "./image-text";
export { galleryBlock } from "./gallery";
export { statsBlock } from "./stats";
export { hoursBlock } from "./hours";
export { contactInfoBlock } from "./contact-info";

// Layout blocks
export { columnsBlock, dividerBlock, spacerBlock } from "./layout";

// Combined export for BlockRenderer
import { heroBlock } from "./hero";
import { servicesBlock } from "./services";
import { servicesFeaturedBlock } from "./services-featured";
import { teamBlock } from "./team";
import { barbersFeaturedBlock } from "./barbers-featured";
import { reviewsBlock } from "./reviews";
import { reviewsGridBlock } from "./reviews-grid";
import { ctaBlock } from "./cta";
import { bookingCtaBlock } from "./booking-cta";
import { textBlock } from "./text";
import { headingBlock } from "./heading";
import { imageTextBlock } from "./image-text";
import { galleryBlock } from "./gallery";
import { statsBlock } from "./stats";
import { hoursBlock } from "./hours";
import { contactInfoBlock } from "./contact-info";
import { columnsBlock, dividerBlock, spacerBlock } from "./layout";

export const blocks = {
  // Sections
  hero: heroBlock,
  services: servicesBlock,
  "services-featured": servicesFeaturedBlock,
  team: teamBlock,
  "barbers-featured": barbersFeaturedBlock,
  reviews: reviewsBlock,
  "reviews-grid": reviewsGridBlock,
  cta: ctaBlock,
  "booking-cta": bookingCtaBlock,
  // Content
  text: textBlock,
  heading: headingBlock,
  "image-text": imageTextBlock,
  gallery: galleryBlock,
  stats: statsBlock,
  hours: hoursBlock,
  "contact-info": contactInfoBlock,
  // Layout
  columns: columnsBlock,
  spacer: spacerBlock,
  divider: dividerBlock,
} as const;

export default blocks;
