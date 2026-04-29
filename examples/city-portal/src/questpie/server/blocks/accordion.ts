import { block } from "#questpie/factories";

import { content } from "./_categories";

export const accordionBlock = block("accordion")
	.admin(({ c }) => ({
		label: "Accordion / FAQ",
		icon: c.icon("ph:list-dashes"),
		category: content(c),
		order: 7,
	}))
	.fields(({ f }) => ({
		title: f.text().label("Title"),
		items: f
			.json()
			.label("Items")
			.description("Array of {title, content} objects"),
		allowMultipleOpen: f.boolean().label("Allow Multiple Open").default(false),
	}));
