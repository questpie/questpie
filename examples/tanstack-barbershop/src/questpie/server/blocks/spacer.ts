import { block } from "#questpie/factories";

import { layout } from "./_categories";

export const spacerBlock = block("spacer")
	.admin(({ c }) => ({
		label: { en: "Spacer", sk: "Medzera" },
		icon: c.icon("ph:arrows-vertical"),
		category: layout(c),
		order: 2,
	}))
	.fields(({ f }) => ({
		size: f
			.select([
				{ value: "small", label: "S" },
				{ value: "medium", label: "M" },
				{ value: "large", label: "L" },
				{ value: "xlarge", label: "XL" },
			])
			.label({ en: "Size", sk: "Veľkosť" })
			.default("medium"),
	}));
