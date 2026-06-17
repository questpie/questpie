import { collection } from "#questpie/factories";

export const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text(255).label("Title").required(),
		slug: f
			.text(255)
			.label("Slug")
			.required()
			.inputOptional()
			.admin({
				compute: {
					handler: ({
						data,
						prev,
					}: {
						data: Record<string, unknown>;
						prev: { data: Record<string, unknown> };
					}) => {
						const title = data.title;
						const currentSlug = data.slug;
						const prevTitle = prev.data.title;

						if (currentSlug && prevTitle === title) return undefined;

						if (title && typeof title === "string") {
							return title
								.toLowerCase()
								.replace(/[^a-z0-9]+/g, "-")
								.replace(/^-|-$/g, "");
						}
						return undefined;
					},
					deps: ({ data }: { data: Record<string, unknown> }) => [
						data.title,
						data.slug,
					],
					debounce: 300,
				},
			}),
		content: f.richText().label("Content"),
		published: f.boolean().label("Published").default(false).required(),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Posts",
		icon: c.icon("ph:article"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.slug, f.published],
			},
			fields: [f.title, f.content],
		}),
	);
