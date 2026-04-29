import { block } from "#questpie/factories";

import { layout } from "./_categories";

export const dividerBlock = block("divider")
	.admin(({ c }) => ({
		label: { en: "Divider", sk: "Oddelovač" },
		icon: c.icon("ph:minus"),
		category: layout(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		style: f
			.select([
				{ value: "solid", label: "Solid" },
				{ value: "dashed", label: "Dashed" },
			])
			.label({ en: "Style", sk: "Štýl" })
			.default("solid"),
		width: f
			.select([
				{ value: "full", label: { en: "Full", sk: "Plná" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "small", label: { en: "Small", sk: "Malá" } },
			])
			.label({ en: "Width", sk: "Šírka" })
			.default("full"),
	}));
