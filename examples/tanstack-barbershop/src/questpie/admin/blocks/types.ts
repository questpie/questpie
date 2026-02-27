/**
 * Block Props Type Helper
 *
 * Extracts typed props from server block definitions,
 * avoiding manual type duplication.
 *
 * @example
 * ```ts
 * import type { BlockProps } from "./types";
 *
 * export function HeroRenderer({ values, data }: BlockProps<"hero">) {
 *   // values.title, values.subtitle etc. are typed
 *   // data.backgroundImage is typed as ExpandedRecord | null
 * }
 * ```
 */

import type { BlockRendererProps } from "@questpie/admin/client";
import type { InferBlockData, InferBlockValues } from "@questpie/admin/server";

// Import block builders directly to avoid depth-limit issues from .generated/index
import type { bookingCtaBlock } from "../../server/blocks/booking-cta";
import type { columnsBlock } from "../../server/blocks/columns";
import type { contactInfoBlock } from "../../server/blocks/contact-info";
import type { ctaBlock } from "../../server/blocks/cta";
import type { dividerBlock } from "../../server/blocks/divider";
import type { galleryBlock } from "../../server/blocks/gallery";
import type { headingBlock } from "../../server/blocks/heading";
import type { heroBlock } from "../../server/blocks/hero";
import type { hoursBlock } from "../../server/blocks/hours";
import type { imageTextBlock } from "../../server/blocks/image-text";
import type { reviewsBlock } from "../../server/blocks/reviews";
import type { servicesBlock } from "../../server/blocks/services";
import type { spacerBlock } from "../../server/blocks/spacer";
import type { statsBlock } from "../../server/blocks/stats";
import type { teamBlock } from "../../server/blocks/team";
import type { textBlock } from "../../server/blocks/text";

type LocalAppBlocks = {
	bookingCta: typeof bookingCtaBlock;
	columns: typeof columnsBlock;
	contactInfo: typeof contactInfoBlock;
	cta: typeof ctaBlock;
	divider: typeof dividerBlock;
	gallery: typeof galleryBlock;
	heading: typeof headingBlock;
	hero: typeof heroBlock;
	hours: typeof hoursBlock;
	imageText: typeof imageTextBlock;
	reviews: typeof reviewsBlock;
	services: typeof servicesBlock;
	spacer: typeof spacerBlock;
	stats: typeof statsBlock;
	team: typeof teamBlock;
	text: typeof textBlock;
};

/**
 * Typed block renderer props.
 * Infers `values` type from server block field definitions
 * and `data` type from `.prefetch()` configuration.
 */
export type BlockProps<TBlockName extends keyof LocalAppBlocks> = BlockRendererProps<
	InferBlockValues<LocalAppBlocks[TBlockName]["state"]>,
	InferBlockData<LocalAppBlocks[TBlockName]>
>;
