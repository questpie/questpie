/**
 * Full-app gate fixture — user collection.
 *
 * Part of the committed synthetic full-app under test/types/__fullapp__/ whose
 * composed `.generated/index.ts` makes the package gate SEE the AppContext⇄config
 * composition (the cycle/`any`-regression the module-only gate is blind to).
 */
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type { DependentRowLockRequest } from "#questpie/server/collection/builder/types.js";

const invalidDependentLock: DependentRowLockRequest = {
	// @ts-expect-error generated lock plans reject unknown collection names
	collection: "zzz_not_a_collection",
	ids: ["missing"],
};
void invalidDependentLock;

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
	}))
	.hooks({
		beforeWrite: {
			locks: ({ data, method }) =>
				method === "updateBatch" || !data.category
					? []
					: [{ collection: "categories", ids: [data.category] }],
			run: async (ctx) => {
				if (ctx.method === "updateBatch" || !ctx.data.category) return;
				const category = await ctx.collections.categories.findOne(
					{
						where: { id: ctx.data.category },
					},
					ctx,
				);
				if (!category) return;
				const slug: string = category.slug;
				void slug;
				// @ts-expect-error generated collection rows reject unknown fields
				void category.doesNotExist;
			},
		},
	});

export default articles;
