/**
 * Pages Collection (Scoped)
 *
 * CMS pages with hierarchical structure and block content.
 */

import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";
import { slugify } from "@/questpie/server/utils";

export const pages = qb
	.collection("pages")
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
		content: f.blocks({
			label: "Content",
		}),
		excerpt: f.textarea({
			label: "Excerpt",
			description: "Short description for listings and SEO",
		}),
		parent: f.relation({
			label: "Parent Page",
			to: "pages",
			description: "For creating page hierarchy",
		}),
		order: f.number({
			label: "Order",
			default: 0,
			description: "Display order in navigation",
		}),
		showInNav: f.boolean({
			label: "Show in Navigation",
			default: true,
		}),
		featuredImage: f.upload({
			label: "Featured Image",
			accept: ["image/*"],
		}),
		isPublished: f.boolean({
			label: "Published",
			default: false,
		}),
		metaTitle: f.text({
			label: "Meta Title",
			maxLength: 70,
		}),
		metaDescription: f.textarea({
			label: "Meta Description",
		}),
	}))
	.indexes(({ table }) => [
		uniqueIndex("pages_city_slug_unique").on(
			table.city as any,
			table.slug as any,
		),
	])
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Pages",
		icon: c.icon("ph:article"),
		description: "Website pages with block-based content",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["title", "slug", "parent", "isPublished"],
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
					f.parent,
					f.order,
					f.showInNav,
					f.isPublished,
				],
			},
			fields: [
				{
					type: "section",
					label: "Page Content",
					fields: [f.title, f.excerpt, f.featuredImage, f.content],
				},
				{
					type: "section",
					label: "SEO",
					layout: "grid",
					columns: 2,
					fields: [
						{
							field: f.metaTitle,
							hidden: ({ data }) => !data.isPublished,
						},
						{
							field: f.metaDescription,
							hidden: ({ data }) => !data.isPublished,
						},
					],
				},
			],
		}),
	)
	.preview({
		enabled: true,
		position: "right",
		defaultWidth: 50,
		url: ({ record }: { record: any }) => {
			// Build preview URL from the page's slug
			const slug = record.slug || "home";
			// In multi-tenant setup, we'd need the city slug too
			return `/pages/${slug}?preview=true`;
		},
	});
