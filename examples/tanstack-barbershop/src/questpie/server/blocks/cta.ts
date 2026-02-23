import { block } from "@questpie/admin/server";
import { sections } from "./_categories";

export const ctaBlock = block("cta")
	.admin(({ c }) => ({
		label: { en: "CTA", sk: "Výzva k akcii" },
		icon: c.icon("ph:megaphone"),
		category: sections(c),
		order: 5,
	}))
	.fields(({ f }) => ({
		title: f.text({
			label: { en: "Title", sk: "Nadpis" },
			localized: true,
			required: true,
		}),
		description: f.textarea({
			label: { en: "Description", sk: "Popis" },
			localized: true,
		}),
		buttonText: f.text({
			label: { en: "Button Text", sk: "Text tlačidla" },
			localized: true,
		}),
		buttonLink: f.text({ label: { en: "Button Link", sk: "Odkaz tlačidla" } }),
		variant: f.select({
			label: { en: "Variant", sk: "Variant" },
			options: [
				{ value: "highlight", label: "Highlight" },
				{ value: "dark", label: "Dark" },
				{ value: "light", label: "Light" },
			],
			defaultValue: "highlight",
		}),
		size: f.select({
			label: { en: "Size", sk: "Veľkosť" },
			options: [
				{ value: "small", label: { en: "Small", sk: "Malá" } },
				{ value: "medium", label: { en: "Medium", sk: "Stredná" } },
				{ value: "large", label: { en: "Large", sk: "Veľká" } },
			],
			defaultValue: "medium",
		}),
	}));
