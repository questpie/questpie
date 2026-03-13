/**
 * Blog Posts Collection
 *
 * Demonstrates context-first service injection:
 * - `services.blog` (from services/blog.ts) is available in hooks via `ctx.services`
 * - `queue` is used to schedule email notifications on publish
 * - No `import { app }` — everything comes from the hook context
 */
import { collection } from "#questpie/factories";

export const blogPosts = collection("blog_posts")
	.fields(({ f }) => ({
		title: f.text().required().label({ en: "Title", sk: "Názov" }),
		slug: f.text().label({ en: "Slug", sk: "Slug" }),
		content: f.richText().label({ en: "Content", sk: "Obsah" }),
		excerpt: f.textarea().label({ en: "Excerpt", sk: "Perex" }),
		readingTime: f
			.number()
			.label({ en: "Reading Time (min)", sk: "Čas čítania (min)" }),
		status: f
			.select([
				{ value: "draft", label: { en: "Draft", sk: "Koncept" } },
				{ value: "published", label: { en: "Published", sk: "Publikované" } },
				{ value: "archived", label: { en: "Archived", sk: "Archivované" } },
			])
			.required()
			.default("draft")
			.label({ en: "Status", sk: "Stav" }),
		publishedAt: f
			.datetime()
			.label({ en: "Published At", sk: "Publikované dňa" }),
		author: f.relation("user").label({ en: "Author", sk: "Autor" }),
		coverImage: f
			.upload({ to: "assets" })
			.label({ en: "Cover Image", sk: "Titulný obrázok" }),
		tags: f
			.text()
			.label({ en: "Tags (comma-separated)", sk: "Tagy (čiarkou oddelené)" }),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: { en: "Blog Posts", sk: "Blogy" },
		icon: c.icon("ph:article"),
		description: { en: "Barbershop blog and news" },
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.title, f.status, f.publishedAt, f.readingTime, f.author],
			searchable: [f.title, f.tags],
			defaultSort: { field: f.publishedAt, direction: "desc" },
			actions: {
				header: { primary: [], secondary: [] },
				row: [],
				bulk: [],
			},
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [
					f.status,
					f.publishedAt,
					f.author,
					f.coverImage,
					f.readingTime,
					f.tags,
				],
			},
			fields: [
				{
					type: "section",
					label: { en: "Content", sk: "Obsah" },
					fields: [f.title, f.slug, f.excerpt, f.content],
				},
			],
		}),
	)
	.hooks({
		/**
		 * Before create/update: auto-compute readingTime and slug via blog service.
		 *
		 * Context-first: `services.blog` is injected from services/blog.ts.
		 */
		beforeChange: async ({ data, operation, services }) => {
			const { blog } = services;

			// Auto-generate slug from title on create (if not set)
			if (operation === "create" && data.title && !data.slug) {
				data.slug = blog.generateSlug(data.title);
			}

			// Always recompute reading time from content
			if (data.content) {
				const contentStr =
					typeof data.content === "string"
						? data.content
						: JSON.stringify(data.content);
				data.readingTime = blog.computeReadingTime(contentStr);
			}

			// Auto-extract excerpt if not provided
			if (data.content && !data.excerpt) {
				const contentStr =
					typeof data.content === "string"
						? data.content
						: JSON.stringify(data.content);
				data.excerpt = blog.extractExcerpt(contentStr);
			}

			// Auto-set publishedAt when publishing and not already set
			if (data.status === "published" && !data.publishedAt) {
				data.publishedAt = new Date();
			}
		},

		/**
		 * After publish: schedule email notification to all subscribers.
		 *
		 * Context-first: `queue` is injected from AppContext (no `import { app }`).
		 */
		afterChange: async ({ data, operation, original, queue }) => {
			const justPublished =
				data.status === "published" &&
				(operation === "create" ||
					(operation === "update" && original?.status !== "published"));

			if (justPublished) {
				// Enqueue subscriber notification
				await queue.notifyBlogSubscribers.publish({
					postId: data.id,
					title: data.title,
					excerpt: data.excerpt || "",
					slug: data.slug || "",
				});
			}
		},
	});
