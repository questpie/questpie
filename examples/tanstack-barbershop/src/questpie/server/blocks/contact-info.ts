import { block } from "#questpie/factories";

import { content } from "./_categories";

export const contactInfoBlock = block("contact-info")
	.admin(({ c }) => ({
		label: { en: "Contact Info", sk: "Kontaktné údaje" },
		icon: c.icon("ph:phone"),
		category: content(c),
		order: 4,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		showMap: f
			.boolean()
			.label({ en: "Show Map", sk: "Zobraziť mapu" })
			.default(true),
	}))
	.prefetch(async ({ ctx }) => {
		const settings = await ctx.globals.site_settings.get({});
		return {
			shopName: settings?.shopName,
			contactEmail: settings?.contactEmail,
			contactPhone: settings?.contactPhone,
			address: settings?.address,
			city: settings?.city,
			zipCode: settings?.zipCode,
			country: settings?.country,
			mapEmbedUrl: settings?.mapEmbedUrl,
		};
	});
