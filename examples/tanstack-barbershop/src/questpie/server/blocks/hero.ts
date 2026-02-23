import { block } from "@questpie/admin/server";
import { sections } from "./_categories";

export const heroBlock = block("hero")
	.admin(({ c }) => ({
		label: { en: "Hero Section", sk: "Hero sekcia" },
		icon: c.icon("ph:image"),
		category: sections(c),
		order: 1,
	}))
	.fields(({ f }) => ({
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		subtitle: f.textarea({
			label: { en: "Subtitle", sk: "Podnadpis" },
			localized: true,
		}),
		backgroundImage: f.upload({
			label: { en: "Background Image", sk: "Obrázok pozadia" },
		}),
		overlayOpacity: f.number({
			label: { en: "Overlay Opacity", sk: "Priehľadnosť" },
			defaultValue: 60,
		}),
		alignment: f.select({
			label: { en: "Alignment", sk: "Zarovnanie" },
			options: [
				{ value: "left", label: { en: "Left", sk: "Vľavo" } },
				{ value: "center", label: { en: "Center", sk: "Stred" } },
				{ value: "right", label: { en: "Right", sk: "Vpravo" } },
			],
			defaultValue: "center",
		}),
		ctaText: f.text({
			label: { en: "CTA Text", sk: "Text tlačidla" },
			localized: true,
		}),
		ctaLink: f.text({ label: { en: "CTA Link", sk: "Odkaz tlačidla" } }),
		height: f.select({
			label: { en: "Height", sk: "Výška" },
			options: [
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
				{ value: "full", label: { en: "Full", sk: "Plná" } },
			],
			defaultValue: "medium",
		}),
	}))
	.prefetch({ with: { backgroundImage: true } });
