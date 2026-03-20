import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const heroBlock = block("hero")
	.admin(({ c }) => ({
		label: "Hero Section",
		icon: c.icon("ph:image"),
		category: sections(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title").required(),
		subtitle: f.textarea().label("Subtitle"),
		backgroundImage: f
			.upload({ mimeTypes: ["image/*"] })
			.label("Background Image"),
		overlayOpacity: f.number().label("Overlay Opacity").default(60),
		alignment: f
			.select([
				{ value: "left", label: "Left" },
				{ value: "center", label: "Center" },
				{ value: "right", label: "Right" },
			])
			.label("Alignment")
			.default("center"),
		ctaText: f.text().label("CTA Text"),
		ctaLink: f.text().label("CTA Link"),
		showSearch: f.boolean().label("Show Search Bar").default(false),
		height: f
			.select([
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
				{ value: "full", label: "Full" },
			])
			.label("Height")
			.default("medium"),
	}));
