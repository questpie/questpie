import { block } from "@questpie/admin/server";
import { content } from "./_categories";

export const galleryBlock = block("gallery")
	.admin(({ c }) => ({
		label: { en: "Gallery", sk: "Galéria" },
		icon: c.icon("ph:images"),
		category: content(c),
		order: 5,
	}))
	.fields(({ f }) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		images: f.upload({
			label: { en: "Images", sk: "Obrázky" },
			multiple: true,
		}),
		columns: f.select({
			label: { en: "Columns", sk: "Stĺpce" },
			options: [
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			],
			defaultValue: "3",
		}),
		gap: f.select({
			label: { en: "Gap", sk: "Medzera" },
			options: [
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			],
			defaultValue: "medium",
		}),
	}))
	.prefetch(async ({ values, ctx }) => {
		const ids = values.images || [];
		if (ids.length === 0) return { imageUrls: {} };
		// assets is a module-provided collection (not in RegisteredCollections)
		const res = await ctx.collections.assets.find({
			where: { id: { in: ids } },
			limit: ids.length,
		});
		const imageUrls: Record<string, string> = {};
		for (const doc of res.docs) {
			imageUrls[doc.id] = doc.url;
		}
		return { imageUrls };
	});
