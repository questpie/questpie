/**
 * News Collection (Scoped)
 *
 * News articles and updates for each city.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";
import { slugify } from "@/questpie/server/utils";

export const news = qb
	.collection("news")
	.fields((f) => ({
		city: f.relation({
			label: "City",
			to: "cities",
			required: true,
		}),
		title: f.text({
			label: "Title",
			required: true,
			maxLength: 255,
		}),
		slug: f.text({
			label: "Slug",
			required: true,
			maxLength: 255,
			input: "optional",
		}),
		excerpt: f.textarea({
			label: "Excerpt",
			description: "Short summary for listings",
		}),
		content: f.richText({
			label: "Content",
		}),
		image: f.upload({
			label: "Featured Image",
			accept: ["image/*"],
		}),
		category: f.select({
			label: "Category",
			options: [
				{ value: "general", label: "General" },
				{ value: "council", label: "Council News" },
				{ value: "events", label: "Events" },
				{ value: "planning", label: "Planning" },
				{ value: "community", label: "Community" },
				{ value: "transport", label: "Transport" },
			],
			default: "general",
		}),
		publishedAt: f.datetime({
			label: "Published Date",
		}),
		author: f.text({
			label: "Author",
			maxLength: 255,
		}),
		isPublished: f.boolean({
			label: "Published",
			default: false,
		}),
		isFeatured: f.boolean({
			label: "Featured",
			default: false,
			description: "Show on homepage",
		}),
	}))
	.indexes(({ table }) => [
		uniqueIndex("news_city_slug_unique").on(
			table.city as any,
			table.slug as any,
		),
	])
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "News",
		icon: c.icon("ph:newspaper"),
		description: "News articles and updates",
	}))
	.list(({ v }) =>
		v.table({
			columns: [
				"title",
				"category",
				"publishedAt",
				"isPublished",
				"isFeatured",
			],
		}),
	)
	.form(({ v, f }) =>
		v.form({
			sidebar: {
				position: "right",
				fields: [
					{
						field: f.slug,
						compute: {
							handler: ({ data, prev }) => {
								const title = data.title;
								const currentSlug = data.slug;
								const prevTitle = prev.data.title;

								if (currentSlug && prevTitle === title) {
									return undefined;
								}

								if (title && typeof title === "string") {
									return slugify(title);
								}

								return undefined;
							},
							deps: ({ data }) => [data.title, data.slug],
							debounce: 300,
						},
					},
					f.city,
					f.category,
					f.publishedAt,
					f.author,
					f.isPublished,
					f.isFeatured,
				],
			},
			fields: [
				{
					type: "section",
					label: "Article",
					fields: [f.title, f.excerpt, f.image, f.content],
				},
			],
		}),
	);
