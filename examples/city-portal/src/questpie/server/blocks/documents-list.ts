import { block } from "#questpie/factories";

import { dynamic } from "./_categories";

export const documentsListBlock = block("documents-list")
	.admin(({ c }) => ({
		label: "Documents List",
		icon: c.icon("ph:file-text"),
		category: dynamic(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title").default("Documents"),
		category: f
			.select([
				{ value: "all", label: "All Categories" },
				{ value: "policy", label: "Policy" },
				{ value: "minutes", label: "Meeting Minutes" },
				{ value: "budget", label: "Budget & Finance" },
				{ value: "planning", label: "Planning" },
				{ value: "strategy", label: "Strategy" },
				{ value: "report", label: "Report" },
				{ value: "form", label: "Form" },
				{ value: "guide", label: "Guide" },
			])
			.label("Filter by Category")
			.default("all"),
		limit: f.number().label("Max Documents").default(10),
	}))
	.prefetch(async ({ values, ctx }) => {
		const where: any = { isPublished: true };
		if (values.category && values.category !== "all") {
			where.category = values.category;
		}

		const res = await ctx.collections.documents.find({
			limit: (values.limit as number) || 10,
			where,
			orderBy: { publishedDate: "desc" },
		});
		return { documents: res.docs };
	});
