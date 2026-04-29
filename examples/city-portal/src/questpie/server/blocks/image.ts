import { block } from "#questpie/factories";

import { content } from "./_categories";

export const imageBlock = block("image")
	.admin(({ c }) => ({
		label: "Image",
		icon: c.icon("ph:image"),
		category: content(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		image: f
			.upload({ mimeTypes: ["image/*"] })
			.label("Image")
			.required(),
		caption: f.text().label("Caption"),
		alt: f
			.text()
			.label("Alt Text")
			.description("Description for accessibility"),
		aspectRatio: f
			.select([
				{ value: "original", label: "Original" },
				{ value: "square", label: "Square" },
				{ value: "video", label: "16:9" },
				{ value: "portrait", label: "3:4" },
			])
			.label("Aspect Ratio")
			.default("original"),
		width: f
			.select([
				{ value: "full", label: "Full Width" },
				{ value: "medium", label: "Medium" },
				{ value: "small", label: "Small" },
			])
			.label("Width")
			.default("full"),
	}));
