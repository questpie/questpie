import { block } from "#questpie/factories";

import { content } from "./_categories";

export const headingBlock = block("heading")
	.admin(({ c }) => ({
		label: "Heading",
		icon: c.icon("ph:text-h-one"),
		category: content(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		text: f.text().label("Text").required(),
		level: f
			.select([
				{ value: "h1", label: "H1" },
				{ value: "h2", label: "H2" },
				{ value: "h3", label: "H3" },
				{ value: "h4", label: "H4" },
			])
			.label("Level")
			.default("h2"),
		align: f
			.select([
				{ value: "left", label: "Left" },
				{ value: "center", label: "Center" },
				{ value: "right", label: "Right" },
			])
			.label("Alignment")
			.default("left"),
	}));
