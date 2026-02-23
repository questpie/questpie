import { block } from "@questpie/admin/server";
import { sections } from "./_categories";

export const bookingCtaBlock = block("booking-cta")
	.admin(({ c }) => ({
		label: { en: "Booking CTA", sk: "Rezervačná výzva" },
		icon: c.icon("ph:calendar-plus"),
		category: sections(c),
		order: 6,
	}))
	.fields(({ f }) => ({
		title: f.text({ label: { en: "Title", sk: "Nadpis" }, localized: true }),
		description: f.textarea({
			label: { en: "Description", sk: "Popis" },
			localized: true,
		}),
		buttonText: f.text({
			label: { en: "Button Text", sk: "Text tlačidla" },
			localized: true,
		}),
		serviceId: f.text({
			label: { en: "Pre-select Service ID", sk: "Predvybraná služba" },
		}),
		barberId: f.text({
			label: { en: "Pre-select Barber ID", sk: "Predvybraný holič" },
		}),
		variant: f.select({
			label: { en: "Variant", sk: "Variant" },
			options: [
				{ value: "default", label: "Default" },
				{ value: "highlight", label: "Highlight" },
				{ value: "outline", label: "Outline" },
			],
			defaultValue: "highlight",
		}),
		size: f.select({
			label: { en: "Size", sk: "Veľkosť" },
			options: [
				{ value: "default", label: "Default" },
				{ value: "lg", label: "Large" },
			],
			defaultValue: "default",
		}),
	}));
