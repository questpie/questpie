import { uniqueIndex } from "questpie/drizzle-pg-core";

import { collection } from "#questpie/factories";
import { slugify } from "@/questpie/server/utils";

export const pages = collection("pages")
	.fields(({ f }) => ({
		title: f
			.text(255)
			.label({ en: "Title", sk: "Názov" })
			.required()
			.localized(),
		slug: f
			.text(255)
			.label({ en: "Slug", sk: "Slug" })
			.required()
			// Allow user to provide slug manually, but auto-generate if empty
			.inputOptional(),
		description: f
			.textarea()
			.label({ en: "Description", sk: "Popis" })
			.localized(),
		content: f.blocks().label({ en: "Content", sk: "Obsah" }).localized(),
		metaTitle: f
			.text(255)
			.label({ en: "Meta Title", sk: "Meta názov" })
			.localized(),
		metaDescription: f
			.textarea()
			.label({ en: "Meta Description", sk: "Meta popis" })
			.localized(),
	}))
	.indexes(({ table }) => [uniqueIndex("pages_slug_unique").on(table.slug)])
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Pages", sk: "Stránky" },
		icon: c.icon("ph:article"),
	}))
	.options({
		versioning: {
			enabled: true,
			maxVersions: 50,
			workflow: {
				initialStage: "draft",
				stages: {
					draft: {
						label: "Draft",
						transitions: ["review", "published"],
					},
					review: {
						label: "In review",
						transitions: ["draft", "published"],
					},
					published: {
						label: "Published",
						transitions: ["draft"],
					},
				},
			},
		},
	})
	.preview({
		enabled: true,
		position: "right",
		defaultWidth: 50,
		url: ({ record }) => {
			const slug = record.slug as string;
			// "home" slug maps to root, others map to /{slug}
			return slug === "home" ? "/?preview=true" : `/${slug}?preview=true`;
		},
	})
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [
					{
						field: f.slug,
						compute: {
							handler: ({ data }) => {
								const title = data.title;
								const currentSlug = data.slug;

								if (
									title &&
									typeof title === "string" &&
									(!currentSlug ||
										(typeof currentSlug === "string" && !currentSlug.trim()))
								) {
									return slugify(title);
								}

								return undefined;
							},
							deps: ({ data }) => [data.title, data.slug],
							debounce: 300,
						},
					},
				],
			},
			fields: [
				{
					type: "section",
					label: { en: "Page Info", sk: "Informácie o stránke" },
					fields: [f.title, f.description],
				},
				{
					type: "section",
					label: { en: "Content", sk: "Obsah" },
					fields: [f.content],
				},
				{
					type: "section",
					label: { en: "SEO", sk: "SEO" },
					layout: "grid",
					columns: 2,
					fields: [f.metaTitle, f.metaDescription],
				},
			],
		}),
	);
