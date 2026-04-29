import { block } from "#questpie/factories";

import { layout } from "./_categories";

export const dividerBlock = block("divider")
	.admin(({ c }) => ({
		label: "Divider",
		icon: c.icon("ph:minus"),
		category: layout(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		style: f
			.select([
				{ value: "solid", label: "Solid" },
				{ value: "dashed", label: "Dashed" },
				{ value: "dotted", label: "Dotted" },
			])
			.label("Style")
			.default("solid"),
		width: f
			.select([
				{ value: "full", label: "Full" },
				{ value: "medium", label: "Medium" },
				{ value: "small", label: "Small" },
			])
			.label("Width")
			.default("full"),
	}));
