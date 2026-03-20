import { block } from "#questpie/factories";

import { content } from "./_categories";

export const hoursBlock = block("hours")
	.admin(({ c }) => ({
		label: { en: "Business Hours", sk: "Otváracie hodiny" },
		icon: c.icon("ph:clock"),
		category: content(c),
		order: 3,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		showClosed: f
			.boolean()
			.label({ en: "Show Closed Days", sk: "Zobraziť zatvorené dni" })
			.default(true),
	}))
	.prefetch(async ({ ctx }) => {
		const settings = await ctx.globals.site_settings.get({});
		return { businessHours: settings?.businessHours };
	});
