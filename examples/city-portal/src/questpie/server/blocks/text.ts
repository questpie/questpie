import { block } from "#questpie/factories";

import { content } from "./_categories";

export const textBlock = block("text")
	.admin(({ c }) => ({
		label: "Text Block",
		icon: c.icon("ph:text-t"),
		category: content(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		content: f.richText().label("Content").required(),
		maxWidth: f
			.select([
				{ value: "narrow", label: "Narrow" },
				{ value: "medium", label: "Medium" },
				{ value: "wide", label: "Wide" },
				{ value: "full", label: "Full" },
			])
			.label("Max Width")
			.default("medium"),
		padding: f
			.select([
				{ value: "none", label: "None" },
				{ value: "small", label: "Small" },
				{ value: "medium", label: "Medium" },
				{ value: "large", label: "Large" },
			])
			.label("Padding")
			.default("medium"),
	}));
