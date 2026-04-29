import { block } from "#questpie/factories";

import { sections } from "./_categories";

export const heroBlock = block("hero")
	.admin(({ c }) => ({
		label: { en: "Hero Section", sk: "Hero sekcia" },
		icon: c.icon("ph:image"),
		category: sections(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized().required(),
		subtitle: f
			.textarea()
			.label({ en: "Subtitle", sk: "Podnadpis" })
			.localized(),
		backgroundImage: f
			.upload()
			.label({ en: "Background Image", sk: "Obrázok pozadia" }),
		overlayOpacity: f
			.number()
			.label({ en: "Overlay Opacity", sk: "Priehľadnosť" })
			.default(60),
		alignment: f
			.select([
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			])
			.label({ en: "Alignment", sk: "Zarovnanie" })
			.default("center"),
		ctaText: f
			.text()
			.label({ en: "CTA Text", sk: "Text tlačidla" })
			.localized(),
		ctaLink: f.text().label({ en: "CTA Link", sk: "Odkaz tlačidla" }),
		height: f
			.select([
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
				{ value: "full", label: { en: "Full", sk: "Plná" } },
			])
			.label({ en: "Height", sk: "Výška" })
			.default("medium"),
	}))
	.prefetch({ with: { backgroundImage: true } });
