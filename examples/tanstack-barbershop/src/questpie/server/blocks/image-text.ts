import { block } from "#questpie/factories";

import { content } from "./_categories";

export const imageTextBlock = block("image-text")
	.admin(({ c }) => ({
		label: { en: "Image + Text", sk: "Obrázok + Text" },
		icon: c.icon("ph:layout"),
		category: content(c),
		order: 6,
	}))
	.fields(({ f }) => ({
		image: f.upload().label({ en: "Image", sk: "Obrázok" }),
		imagePosition: f
			.select([
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			])
			.label({ en: "Image Position", sk: "Pozícia obrázka" })
			.default("left"),
		title: f.text().label({ en: "Title", sk: "Nadpis" }).localized().required(),
		content: f.richText().label({ en: "Content", sk: "Obsah" }).localized(),
		ctaText: f
			.text()
			.label({ en: "CTA Text", sk: "Text tlačidla" })
			.localized(),
		ctaLink: f.text().label({ en: "CTA Link", sk: "Odkaz" }),
		imageAspect: f
			.select([
				{ value: "square", label: "Square" },
				{ value: "portrait", label: "Portrait" },
				{ value: "landscape", label: "Landscape" },
			])
			.label({ en: "Image Aspect", sk: "Pomer strán" })
			.default("square"),
	}))
	.prefetch({ with: { image: true } });
