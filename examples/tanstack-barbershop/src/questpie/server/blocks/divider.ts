import { block } from "@questpie/admin/server";
import { layout } from "./_categories";

export const dividerBlock = block("divider")
	.admin(({ c }) => ({
		label: { en: "Divider", sk: "Oddelovač" },
		icon: c.icon("ph:minus"),
		category: layout(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		style: f.select({
			label: { en: "Style", sk: "Štýl" },
			options: [
				{ value: "solid", label: "Solid" },
				{ value: "dashed", label: "Dashed" },
			],
			defaultValue: "solid",
		}),
		width: f.select({
			label: { en: "Width", sk: "Šírka" },
			options: [
				{ value: "full", label: { en: "Full", sk: "Plná" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "small", label: { en: "Small", sk: "Malá" } },
			],
			defaultValue: "full",
		}),
	}));
