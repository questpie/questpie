import { block } from "#questpie/factories";

import { content } from "./_categories";

export const imageTextBlock = block("image-text")
	.admin(({ c }) => ({
		label: "Image + Text",
		icon: c.icon("ph:layout"),
		category: content(c),
		order: 5,
	}))
	.fields(({ f }) => ({
		image: f.upload({ mimeTypes: ["image/*"] }).label("Image"),
		imagePosition: f
			.select([
				{ value: "left", label: "Left" },
				{ value: "right", label: "Right" },
			])
			.label("Image Position")
			.default("left"),
		title: f.text().label("Title"),
		content: f.richText().label("Content"),
		ctaText: f.text().label("CTA Text"),
		ctaLink: f.text().label("CTA Link"),
	}));
