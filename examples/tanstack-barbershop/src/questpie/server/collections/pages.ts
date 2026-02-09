import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";

/**
 * Helper function to convert string to URL-friendly slug
 */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove diacritics
		.replace(/[^a-z0-9]+/g, "-") // Replace non-alphanumeric with hyphens
		.replace(/^-+|-+$/g, "") // Trim hyphens from start/end
		.slice(0, 255);
}

export const pages = qb
	.collection("pages")
	.fields((f) => ({
		title: f.text({ required: true, maxLength: 255, localized: true }),
		slug: f.text({
			required: true,
			maxLength: 255,
			// Allow user to provide slug manually, but auto-generate if empty
			input: "optional",
			meta: {
				admin: {
					// Auto-generate slug from title when title changes and slug is empty
					compute: {
						handler: ({
							data,
							prev,
						}: {
							data: Record<string, unknown>;
							prev: { data: Record<string, unknown> };
						}) => {
							// Only compute if slug is empty or title changed
							const title = data.title;
							const currentSlug = data.slug;
							const prevTitle = prev.data.title;

							// If slug already exists and wasn't auto-generated, keep it
							if (currentSlug && prevTitle === title) {
								return undefined; // No change
							}

							// Auto-generate from title
							if (title && typeof title === "string") {
								return slugify(title);
							}

							return undefined;
						},
						deps: ({ data }: { data: Record<string, unknown> }) => [
							data.title,
							data.slug,
						],
						debounce: 300,
					},
				},
			},
		}),
		description: f.textarea({ localized: true }),
		content: f.blocks({ localized: true }),
		// SEO fields - hidden until page is published
		metaTitle: f.text({
			maxLength: 255,
			localized: true,
			meta: {
				admin: {
					// Show SEO fields only when page is published
					hidden: ({ data }: { data: Record<string, unknown> }) =>
						!data.isPublished,
				},
			},
		}),
		metaDescription: f.textarea({
			localized: true,
			meta: {
				admin: {
					// Show SEO fields only when page is published
					hidden: ({ data }: { data: Record<string, unknown> }) =>
						!data.isPublished,
				},
			},
		}),
		isPublished: f.boolean({ default: false, required: true }),
	}))
	.indexes(({ table }) => [
		uniqueIndex("pages_slug_unique").on(table.slug as any),
	])
	.title(({ f }) => f.title);
