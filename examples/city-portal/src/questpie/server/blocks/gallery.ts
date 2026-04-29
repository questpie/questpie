import { block } from "#questpie/factories";

import { content } from "./_categories";

export const galleryBlock = block("gallery")
	.admin(({ c }) => ({
		label: "Gallery",
		icon: c.icon("ph:images"),
		category: content(c),
		order: 4,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title"),
		images: f.json().label("Images").description("Array of image data"),
		columns: f
			.select([
				{ value: "2", label: "2" },
				{ value: "3", label: "3" },
				{ value: "4", label: "4" },
			])
			.label("Columns")
			.default("3"),
		showCaptions: f.boolean().label("Show Captions").default(true),
		gap: f
			.select([
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label("Gap")
			.default("medium"),
	}));
