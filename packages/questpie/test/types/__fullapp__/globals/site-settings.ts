/**
 * Full-app gate fixture — user global.
 *
 * @see ../collections/articles.ts for the fixture's purpose.
 */
import { global } from "#questpie/server/global/builder/global-builder.js";

export const siteSettings = global("siteSettings").fields(({ f }) => ({
	siteName: f.text().label("Site Name").required().default("Fixture Site"),
	tagline: f.text().label("Tagline"),
}));

export default siteSettings;
