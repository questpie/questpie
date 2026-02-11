import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";
import { slugify } from "@/questpie/server/utils";

export const pages = qb
	.collection("pages")
	.fields((f) => ({
		title: f.text({
			label: { en: "Title", sk: "Názov" },
			required: true,
			maxLength: 255,
			localized: true,
		}),
		slug: f.text({
			label: { en: "Slug", sk: "Slug" },
			required: true,
			maxLength: 255,
			// Allow user to provide slug manually, but auto-generate if empty
			input: "optional",
		}),
		description: f.textarea({
			label: { en: "Description", sk: "Popis" },
			localized: true,
		}),
		content: f.blocks({
			label: { en: "Content", sk: "Obsah" },
			localized: true,
		}),
		// SEO fields - hidden until page is published
		metaTitle: f.text({
			label: { en: "Meta Title", sk: "Meta názov" },
			maxLength: 255,
			localized: true,
		}),
		metaDescription: f.textarea({
			label: { en: "Meta Description", sk: "Meta popis" },
			localized: true,
		}),
		isPublished: f.boolean({
			label: { en: "Published", sk: "Publikované" },
			default: false,
			required: true,
		}),
	}))
	.indexes(({ table }) => [
		uniqueIndex("pages_slug_unique").on(table.slug as any),
	])
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Pages", sk: "Stránky" },
		icon: c.icon("ph:article"),
	}))
	.list(({ v }) => v.table({}))
	.form(({ v, f }) =>
		v.form({
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
					f.isPublished,
				],
			},
			fields: [
				{
					type: "section",
					label: { en: "Page Info", sk: "Informácie o stránke" },
					layout: "grid",
					columns: 2,
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
	);
