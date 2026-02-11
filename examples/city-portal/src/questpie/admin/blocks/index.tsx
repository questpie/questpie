/**
 * City Portal Block Renderers Index
 *
 * Maps block type names to React renderer components.
 */

import { AccordionRenderer } from "./accordion";
import { CTARenderer } from "./cta";
import {
	AnnouncementBannerRenderer,
	ContactsListRenderer,
	DocumentsListRenderer,
	LatestNewsRenderer,
} from "./dynamic";
import { GalleryRenderer } from "./gallery";
import { HeadingRenderer } from "./heading";
import { HeroRenderer } from "./hero";
import { ImageRenderer } from "./image";
import { ImageTextRenderer } from "./image-text";
import { ColumnsRenderer, DividerRenderer, SpacerRenderer } from "./layout";
import { TextRenderer } from "./text";
import { VideoRenderer } from "./video";

export const renderers = {
	// Sections
	hero: HeroRenderer,
	cta: CTARenderer,
	"announcement-banner": AnnouncementBannerRenderer,
	// Content
	text: TextRenderer,
	heading: HeadingRenderer,
	image: ImageRenderer,
	gallery: GalleryRenderer,
	"image-text": ImageTextRenderer,
	video: VideoRenderer,
	accordion: AccordionRenderer,
	// Dynamic
	"latest-news": LatestNewsRenderer,
	"contacts-list": ContactsListRenderer,
	"documents-list": DocumentsListRenderer,
	// Layout
	columns: ColumnsRenderer,
	spacer: SpacerRenderer,
	divider: DividerRenderer,
} as any;

export default renderers;
