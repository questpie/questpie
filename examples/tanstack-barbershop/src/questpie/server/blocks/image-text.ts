import { block } from "@questpie/admin/server";
import { content } from "./_categories";

export const imageTextBlock = block("image-text")
	.admin(({ c }) => ({
		label: { en: "Image + Text", sk: "Obrázok + Text" },
		icon: c.icon("ph:layout"),
		category: content(c),
		order: 6,
	}))
	.fields(({ f }) => ({
		image: f.upload({ label: { en: "Image", sk: "Obrázok" } }),
		imagePosition: f.select({
			label: { en: "Image Position", sk: "Pozícia obrázka" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "left",
		}),
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		content: f.richText({
			label: { en: "Content", sk: "Obsah" },
			localized: true,
		}),
		ctaText: f.text({
			label: { en: "CTA Text", sk: "Text tlačidla" },
			localized: true,
		}),
		ctaLink: f.text({ label: { en: "CTA Link", sk: "Odkaz" } }),
		imageAspect: f.select({
			label: { en: "Image Aspect", sk: "Pomer strán" },
			options: [
				{ value: "square", label: "Square" },
				{ value: "portrait", label: "Portrait" },
				{ value: "landscape", label: "Landscape" },
			],
			defaultValue: "square",
		}),
	}))
	.prefetch({ with: { image: true } });
