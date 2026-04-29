import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const bookingCtaBlock = block("booking-cta")
	.admin(({ c }) => ({
		label: { en: "Booking CTA", sk: "Rezervačná výzva" },
		icon: c.icon("ph:calendar-plus"),
		category: sections(c),
		order: 6,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized(),
		description: f
			.textarea()
			.label({ en: "Description", sk: "Popis" })
			.localized(),
		buttonText: f
			.text()
			.label({ en: "Button Text", sk: "Text tlačidla" })
			.localized(),
		serviceId: f
			.text()
			.label({ en: "Pre-select Service ID", sk: "Predvybraná služba" }),
		barberId: f
			.text()
			.label({ en: "Pre-select Barber ID", sk: "Predvybraný holič" }),
		variant: f
			.select([
				{ value: "default", label: "Default" },
				{ value: "highlight", label: "Highlight" },
				{ value: "outline", label: "Outline" },
			])
			.label({ en: "Variant", sk: "Variant" })
			.default("highlight"),
		size: f
			.select([
				{ value: "default", label: "Default" },
				{ value: "lg", label: "Large" },
			])
			.label({ en: "Size", sk: "Veľkosť" })
			.default("default"),
	}));
