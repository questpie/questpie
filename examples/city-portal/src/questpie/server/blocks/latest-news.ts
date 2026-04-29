import { block } from "#questpie/factories";

import { dynamic } from "./_categories";

export const latestNewsBlock = block("latest-news")
	.admin(({ c }) => ({
		label: "Latest News",
		icon: c.icon("ph:newspaper"),
		category: dynamic(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title").default("Latest News"),
		count: f.number().label("Number of Articles").default(3),
		showFeatured: f.boolean().label("Show Featured First").default(true),
		category: f
			.select([
				{ value: "all", label: "All Categories" },
				{ value: "general", label: "General" },
				{ value: "council", label: "Council News" },
				{ value: "events", label: "Events" },
				{ value: "planning", label: "Planning" },
				{ value: "community", label: "Community" },
				{ value: "transport", label: "Transport" },
			])
			.label("Filter by Category")
			.default("all"),
		layout: f
			.select([
				{ value: "grid", label: "Grid" },
				{ value: "list", label: "List" },
			])
			.label("Layout")
			.default("grid"),
	}))
	.prefetch(async ({ values, ctx }) => {
		const where: any = {};
		if (values.category && values.category !== "all") {
			where.category = values.category;
		}

		const res = await ctx.collections.news.find({
			limit: (values.count as number) || 3,
			where,
			orderBy: values.showFeatured
				? [{ isFeatured: "desc" }, { publishedAt: "desc" }]
				: { publishedAt: "desc" },
		});
		return { news: res.docs };
	});
