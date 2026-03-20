import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const reviewsBlock = block("reviews")
	.admin(({ c }) => ({
		label: { en: "Reviews", sk: "Recenzie" },
		icon: c.icon("ph:star"),
		category: sections(c),
		order: 4,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		subtitle: f
			.textarea()
			.label({ en: "Subtitle", sk: "Podnadpis" })
			.localized(),
		filter: f
			.select([
				{
					value: "featured",
					label: { en: "Featured (4-5 stars)", sk: "Odporúčané (4-5 hviezd)" },
				},
				{ value: "recent", label: { en: "Recent", sk: "Najnovšie" } },
				{ value: "all", label: { en: "All", sk: "Všetky" } },
			])
			.label({ en: "Filter", sk: "Filter" })
			.default("featured"),
		limit: f.number().label({ en: "Limit", sk: "Limit" }).default(3),
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label({ en: "Columns", sk: "Stĺpce" })
			.default("3"),
	}))
	.prefetch(async ({ values, ctx }) => {
		const where: Record<string, unknown> = {};
		if (values.filter === "featured") {
			where.rating = { in: ["4", "5"] };
		}
		const res = await ctx.collections.reviews.find({
			limit: (values.limit as number) || 3,
			where,
			orderBy: { createdAt: "desc" },
		});
		return { reviews: res.docs };
	});
