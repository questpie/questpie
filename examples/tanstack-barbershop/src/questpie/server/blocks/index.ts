/**
 * Barbershop Blocks
 *
 * Re-exports all block definitions from individual files.
 * Each block is defined in its own file using the standalone `block()` factory
 * from `@questpie/admin/server`.
 */

export { bookingCtaBlock } from "./booking-cta";
export { columnsBlock } from "./columns";
export { contactInfoBlock } from "./contact-info";
export { ctaBlock } from "./cta";
export { dividerBlock } from "./divider";
export { galleryBlock } from "./gallery";
export { headingBlock } from "./heading";
export { heroBlock } from "./hero";
export { hoursBlock } from "./hours";
export { imageTextBlock } from "./image-text";
export { reviewsBlock } from "./reviews";
export { servicesBlock } from "./services";
export { spacerBlock } from "./spacer";
export { statsBlock } from "./stats";
export { teamBlock } from "./team";
export { textBlock } from "./text";

import { bookingCtaBlock } from "./booking-cta";
import { columnsBlock } from "./columns";
import { contactInfoBlock } from "./contact-info";
import { ctaBlock } from "./cta";
import { dividerBlock } from "./divider";
import { galleryBlock } from "./gallery";
import { headingBlock } from "./heading";
// Aggregate blocks object for registration with .blocks()
import { heroBlock } from "./hero";
import { hoursBlock } from "./hours";
import { imageTextBlock } from "./image-text";
import { reviewsBlock } from "./reviews";
import { servicesBlock } from "./services";
import { spacerBlock } from "./spacer";
import { statsBlock } from "./stats";
import { teamBlock } from "./team";
import { textBlock } from "./text";

export const blocks = {
	hero: heroBlock,
	text: textBlock,
	heading: headingBlock,
	services: servicesBlock,
	team: teamBlock,
	reviews: reviewsBlock,
	cta: ctaBlock,
	columns: columnsBlock,
	spacer: spacerBlock,
	divider: dividerBlock,
	hours: hoursBlock,
	"contact-info": contactInfoBlock,
	"booking-cta": bookingCtaBlock,
	gallery: galleryBlock,
	"image-text": imageTextBlock,
	stats: statsBlock,
};
