import { global } from "#questpie/factories";
import type { WorkingHours } from "../collections/barbers";

export type NavItem = {
	label: string;
	href: string;
	isExternal?: boolean;
};

export type FooterLink = {
	label: string;
	href: string;
	isExternal?: boolean;
};

export type SocialLink = {
	platform: "instagram" | "facebook" | "twitter" | "tiktok" | "youtube";
	url: string;
};

export type BookingSettings = {
	minAdvanceHours: number;
	maxAdvanceDays: number;
	slotDurationMinutes: number;
	allowCancellation: boolean;
	cancellationDeadlineHours: number;
};

export const siteSettings = global("site_settings")
	.fields(({ f }) => ({
		shopName: f
			.text()
			.label({ en: "Shop Name", sk: "Názov obchodu" })
			.required()
			.default("Sharp Cuts"),
		tagline: f
			.text()
			.label({ en: "Tagline", sk: "Slogan" })
			.default("Your Style, Our Passion")
			.localized(),
		logo: f.upload({ to: "assets" }).label({ en: "Logo", sk: "Logo" }),

		navigation: f
			.object({
				label: f.text().label({ en: "Label", sk: "Názov" }).required(),
				href: f.text().label({ en: "URL", sk: "URL" }).required(),
				isExternal: f
					.boolean()
					.label({ en: "External Link", sk: "Externý odkaz" })
					.default(false),
			})
			.array()
			.label({ en: "Navigation", sk: "Navigácia" })
			.localized()
			.default([
				{ label: "Home", href: "/" },
				{ label: "Services", href: "/services" },
				{ label: "Our Team", href: "/barbers" },
				{ label: "Contact", href: "/contact" },
			] satisfies NavItem[]),
		ctaButtonText: f
			.text()
			.label({ en: "CTA Button Text", sk: "Text CTA tlačidla" })
			.default("Book Now")
			.localized(),
		ctaButtonLink: f
			.text()
			.label({ en: "CTA Button Link", sk: "Odkaz CTA tlačidla" })
			.default("/booking"),

		footerTagline: f
			.text()
			.label({ en: "Footer Tagline", sk: "Slogan v päte" })
			.default("Your Style, Our Passion")
			.localized(),
		footerLinks: f
			.object({
				label: f.text().label({ en: "Label", sk: "Názov" }).required(),
				href: f.text().label({ en: "URL", sk: "URL" }).required(),
				isExternal: f
					.boolean()
					.label({ en: "External Link", sk: "Externý odkaz" })
					.default(false),
			})
			.array()
			.label({ en: "Footer Links", sk: "Odkazy v päte" })
			.localized()
			.default([
				{ label: "Services", href: "/services" },
				{ label: "Our Team", href: "/barbers" },
				{ label: "Contact", href: "/contact" },
				{ label: "Privacy Policy", href: "/privacy" },
			] satisfies FooterLink[]),
		copyrightText: f
			.text()
			.label({ en: "Copyright Text", sk: "Text copyrightu" })
			.default("Sharp Cuts. All rights reserved.")
			.localized(),

		contactEmail: f
			.email()
			.label({ en: "Email", sk: "Email" })
			.required()
			.default("hello@barbershop.com"),
		contactPhone: f
			.text()
			.label({ en: "Phone", sk: "Telefón" })
			.default("+1 555 0100"),
		address: f
			.text()
			.label({ en: "Address", sk: "Adresa" })
			.default("123 Main Street"),
		city: f.text().label({ en: "City", sk: "Mesto" }).default("New York"),
		zipCode: f.text().label({ en: "ZIP Code", sk: "PSČ" }).default("10001"),
		country: f.text().label({ en: "Country", sk: "Krajina" }).default("USA"),
		mapEmbedUrl: f.text().label({ en: "Map Embed URL", sk: "URL mapy" }),

		isOpen: f
			.boolean()
			.label({ en: "Open", sk: "Otvorené" })
			.default(true)
			.required(),
		bookingEnabled: f
			.boolean()
			.label({ en: "Booking Enabled", sk: "Rezervácie povolené" })
			.default(true)
			.required(),

		businessHours: f
			.object({
				monday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Monday", sk: "Pondelok" }),
				tuesday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Tuesday", sk: "Utorok" }),
				wednesday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Wednesday", sk: "Streda" }),
				thursday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Thursday", sk: "Štvrtok" }),
				friday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Friday", sk: "Piatok" }),
				saturday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Saturday", sk: "Sobota" }),
				sunday: f
					.object({
						isOpen: f
							.boolean()
							.label({ en: "Open", sk: "Otvorené" })
							.default(true)
							.required(),
						start: f.time().label({ en: "Start", sk: "Začiatok" }),
						end: f.time().label({ en: "End", sk: "Koniec" }),
					})
					.label({ en: "Sunday", sk: "Nedeľa" }),
			})
			.label({ en: "Business Hours", sk: "Otváracie hodiny" })
			.default({
				monday: { isOpen: true, start: "09:00", end: "18:00" },
				tuesday: { isOpen: true, start: "09:00", end: "18:00" },
				wednesday: { isOpen: true, start: "09:00", end: "18:00" },
				thursday: { isOpen: true, start: "09:00", end: "20:00" },
				friday: { isOpen: true, start: "09:00", end: "20:00" },
				saturday: { isOpen: true, start: "10:00", end: "16:00" },
				sunday: { isOpen: false, start: "", end: "" },
			} satisfies WorkingHours),

		bookingSettings: f
			.object({
				minAdvanceHours: f
					.number()
					.label({ en: "Min. Advance (hours)", sk: "Min. vopred (hodiny)" })
					.required(),
				maxAdvanceDays: f
					.number()
					.label({ en: "Max. Advance (days)", sk: "Max. vopred (dni)" })
					.required(),
				slotDurationMinutes: f
					.number()
					.label({ en: "Slot Duration (min)", sk: "Trvanie slotu (min)" })
					.required(),
				allowCancellation: f
					.boolean()
					.label({ en: "Allow Cancellation", sk: "Povoliť zrušenie" })
					.required(),
				cancellationDeadlineHours: f
					.number()
					.label({
						en: "Cancellation Deadline (hours)",
						sk: "Lehota na zrušenie (hodiny)",
					})
					.required(),
			})
			.label({ en: "Booking Settings", sk: "Nastavenia rezervácií" })
			.default({
				minAdvanceHours: 2,
				maxAdvanceDays: 30,
				slotDurationMinutes: 30,
				allowCancellation: true,
				cancellationDeadlineHours: 24,
			} satisfies BookingSettings),

		socialLinks: f
			.object({
				platform: f
					.select([
						{ value: "instagram", label: "Instagram" },
						{ value: "facebook", label: "Facebook" },
						{ value: "twitter", label: "Twitter" },
						{ value: "tiktok", label: "TikTok" },
						{ value: "youtube", label: "YouTube" },
					])
					.label({ en: "Platform", sk: "Platforma" })
					.required(),
				url: f.url().label({ en: "URL", sk: "URL" }).required(),
			})
			.array()
			.label({ en: "Social Links", sk: "Sociálne siete" })
			.default([
				{ platform: "instagram", url: "https://instagram.com/sharpcuts" },
				{ platform: "facebook", url: "https://facebook.com/sharpcuts" },
			] satisfies SocialLink[]),

		metaTitle: f
			.text()
			.label({ en: "Meta Title", sk: "Meta názov" })
			.default("Sharp Cuts - Premium Barbershop")
			.localized(),
		metaDescription: f
			.textarea()
			.label({ en: "Meta Description", sk: "Meta popis" })
			.default(
				"Professional barbershop services - haircuts, beard grooming, and more.",
			)
			.localized(),
	}))
	.admin(({ c }) => ({
		label: { en: "Site Settings", sk: "Nastavenia webu" },
		icon: c.icon("ph:gear"),
	}))
	.form(({ v, f }) =>
		v.globalForm({
			fields: [
				{
					type: "section",
					label: { en: "Branding", sk: "Značka" },
					layout: "grid",
					columns: 2,
					fields: [f.shopName, f.tagline, f.logo],
				},
				{
					type: "section",
					label: { en: "Navigation", sk: "Navigácia" },
					fields: [f.navigation, f.ctaButtonText, f.ctaButtonLink],
				},
				{
					type: "section",
					label: { en: "Footer", sk: "Päta" },
					fields: [f.footerTagline, f.footerLinks, f.copyrightText],
				},
				{
					type: "section",
					label: { en: "Contact", sk: "Kontakt" },
					layout: "grid",
					columns: 2,
					fields: [
						f.contactEmail,
						f.contactPhone,
						f.address,
						f.city,
						f.zipCode,
						f.country,
					],
				},
				{
					type: "section",
					label: { en: "Map", sk: "Mapa" },
					fields: [f.mapEmbedUrl],
				},
				{
					type: "section",
					label: { en: "Business", sk: "Prevádzka" },
					layout: "grid",
					columns: 2,
					fields: [f.isOpen, f.bookingEnabled],
				},
				{
					type: "section",
					label: { en: "Business Hours", sk: "Otváracie hodiny" },
					fields: [f.businessHours],
				},
				{
					type: "section",
					label: { en: "Booking Settings", sk: "Nastavenia rezervácií" },
					fields: [f.bookingSettings],
				},
				{
					type: "section",
					label: { en: "Social Links", sk: "Sociálne siete" },
					fields: [f.socialLinks],
				},
				{
					type: "section",
					label: { en: "SEO", sk: "SEO" },
					layout: "grid",
					columns: 2,
					fields: [f.metaTitle, f.metaDescription],
				},
			],
		}),
	)
	.options({
		timestamps: true,
		versioning: true,
	})
	.access({
		read: true,
		update: ({ session }) =>
			(session?.user as { role?: string } | undefined)?.role === "admin",
	});
