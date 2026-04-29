import { block } from "#questpie/factories";

import { content } from "./_categories";

export const galleryBlock = block("gallery")
	.admin(({ c }) => ({
		label: { en: "Gallery", sk: "Galéria" },
		icon: c.icon("ph:images"),
		category: content(c),
		order: 5,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		images: f.upload().label({ en: "Images", sk: "Obrázky" }).multiple(),
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label({ en: "Columns", sk: "Stĺpce" })
			.default("3"),
		gap: f
			.select([
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label({ en: "Gap", sk: "Medzera" })
			.default("medium"),
	}))
	.prefetch(async ({ values, ctx }) => {
		const ids = (values.images as unknown as string[]) || [];
		if (ids.length === 0) return { imageUrls: {} };
		// assets is a module-provided collection (not in RegisteredCollections)
		const res = await ctx.collections.assets.find({
			where: { id: { in: ids } },
			limit: ids.length,
		});
		const imageUrls: Record<string, string> = {};
		for (const doc of res.docs) {
			imageUrls[doc.id as string] = doc.url as string;
		}
		return { imageUrls };
	});
