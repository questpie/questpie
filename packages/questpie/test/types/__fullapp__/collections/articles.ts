/**
 * Full-app gate fixture — user collection.
 *
 * Part of the committed synthetic full-app under test/types/__fullapp__/ whose
 * composed `.generated/index.ts` makes the package gate SEE the AppContext⇄config
 * composition (the cycle/`any`-regression the module-only gate is blind to).
 */
import { collection } from "#questpie/server/collection/builder/collection-builder.js";

export const articles = collection("articles")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		title: f.text(255).label("Title").required(),
		body: f.text().label("Body"),
		category: f.relation("categories").label("Category"),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
			])
			.label("Status")
			.required()
			.default("draft"),
	}));

export default articles;
