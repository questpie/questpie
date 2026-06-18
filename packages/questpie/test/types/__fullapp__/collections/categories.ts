/**
 * Full-app gate fixture — user collection.
 *
 * @see ./articles.ts for the fixture's purpose.
 */
import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export const categories = collection("categories")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		slug: f.text(255).label("Slug").required(),
	}));

export default categories;
