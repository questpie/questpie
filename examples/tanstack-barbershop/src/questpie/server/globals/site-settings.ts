import { qb } from "@/questpie/server/builder";
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

export const siteSettings = qb
	.global("site_settings")
	.fields((f) => ({
		shopName: f.text({
			label: { en: "Shop Name", sk: "Názov obchodu" },
			required: true,
			default: "Sharp Cuts",
		}),
		tagline: f.text({
			label: { en: "Tagline", sk: "Slogan" },
			default: "Your Style, Our Passion",
			localized: true,
		}),
		logo: f.upload({
			to: "assets",
			label: { en: "Logo", sk: "Logo" },
		}),

		navigation: f.array({
			label: { en: "Navigation", sk: "Navigácia" },
			localized: true,
			default: [
				{ label: "Home", href: "/" },
				{ label: "Services", href: "/services" },
				{ label: "Our Team", href: "/barbers" },
				{ label: "Contact", href: "/contact" },
			] satisfies NavItem[],
			of: f.object({
				fields: {
					label: f.text({
						label: { en: "Label", sk: "Názov" },
						required: true,
					}),
					href: f.text({
						label: { en: "URL", sk: "URL" },
						required: true,
					}),
					isExternal: f.boolean({
						label: { en: "External Link", sk: "Externý odkaz" },
						default: false,
					}),
				},
			}),
		}),
		ctaButtonText: f.text({
			label: { en: "CTA Button Text", sk: "Text CTA tlačidla" },
			default: "Book Now",
			localized: true,
		}),
		ctaButtonLink: f.text({
			label: { en: "CTA Button Link", sk: "Odkaz CTA tlačidla" },
			default: "/booking",
		}),

		footerTagline: f.text({
			label: { en: "Footer Tagline", sk: "Slogan v päte" },
			default: "Your Style, Our Passion",
			localized: true,
		}),
		footerLinks: f.array({
			label: { en: "Footer Links", sk: "Odkazy v päte" },
			localized: true,
			default: [
				{ label: "Services", href: "/services" },
				{ label: "Our Team", href: "/barbers" },
				{ label: "Contact", href: "/contact" },
				{ label: "Privacy Policy", href: "/privacy" },
			] satisfies FooterLink[],
			of: f.object({
				fields: {
					label: f.text({
						label: { en: "Label", sk: "Názov" },
						required: true,
					}),
					href: f.text({
						label: { en: "URL", sk: "URL" },
						required: true,
					}),
					isExternal: f.boolean({
						label: { en: "External Link", sk: "Externý odkaz" },
						default: false,
					}),
				},
			}),
		}),
		copyrightText: f.text({
			label: { en: "Copyright Text", sk: "Text copyrightu" },
			default: "Sharp Cuts. All rights reserved.",
			localized: true,
		}),

		contactEmail: f.email({
			label: { en: "Email", sk: "Email" },
			required: true,
			default: "hello@barbershop.com",
		}),
		contactPhone: f.text({
			label: { en: "Phone", sk: "Telefón" },
			default: "+1 555 0100",
		}),
		address: f.text({
			label: { en: "Address", sk: "Adresa" },
			default: "123 Main Street",
		}),
		city: f.text({
			label: { en: "City", sk: "Mesto" },
			default: "New York",
		}),
		zipCode: f.text({
			label: { en: "ZIP Code", sk: "PSČ" },
			default: "10001",
		}),
		country: f.text({
			label: { en: "Country", sk: "Krajina" },
			default: "USA",
		}),
		mapEmbedUrl: f.text({
			label: { en: "Map Embed URL", sk: "URL mapy" },
		}),

		isOpen: f.boolean({
			label: { en: "Open", sk: "Otvorené" },
			default: true,
			required: true,
		}),
		bookingEnabled: f.boolean({
			label: { en: "Booking Enabled", sk: "Rezervácie povolené" },
			default: true,
			required: true,
		}),

		businessHours: f.object({
			label: { en: "Business Hours", sk: "Otváracie hodiny" },
			default: {
				monday: { isOpen: true, start: "09:00", end: "18:00" },
				tuesday: { isOpen: true, start: "09:00", end: "18:00" },
				wednesday: { isOpen: true, start: "09:00", end: "18:00" },
				thursday: { isOpen: true, start: "09:00", end: "20:00" },
				friday: { isOpen: true, start: "09:00", end: "20:00" },
				saturday: { isOpen: true, start: "10:00", end: "16:00" },
				sunday: { isOpen: false, start: "", end: "" },
			} satisfies WorkingHours,
			fields: {
				monday: f.object({
					label: { en: "Monday", sk: "Pondelok" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				tuesday: f.object({
					label: { en: "Tuesday", sk: "Utorok" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				wednesday: f.object({
					label: { en: "Wednesday", sk: "Streda" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				thursday: f.object({
					label: { en: "Thursday", sk: "Štvrtok" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				friday: f.object({
					label: { en: "Friday", sk: "Piatok" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				saturday: f.object({
					label: { en: "Saturday", sk: "Sobota" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
				sunday: f.object({
					label: { en: "Sunday", sk: "Nedeľa" },
					fields: {
						isOpen: f.boolean({
							label: { en: "Open", sk: "Otvorené" },
							default: true,
							required: true,
						}),
						start: f.time({
							label: { en: "Start", sk: "Začiatok" },
						}),
						end: f.time({
							label: { en: "End", sk: "Koniec" },
						}),
					},
				}),
			},
		}),

		bookingSettings: f.object({
			label: { en: "Booking Settings", sk: "Nastavenia rezervácií" },
			default: {
				minAdvanceHours: 2,
				maxAdvanceDays: 30,
				slotDurationMinutes: 30,
				allowCancellation: true,
				cancellationDeadlineHours: 24,
			} satisfies BookingSettings,
			fields: {
				minAdvanceHours: f.number({
					label: { en: "Min. Advance (hours)", sk: "Min. vopred (hodiny)" },
					required: true,
				}),
				maxAdvanceDays: f.number({
					label: { en: "Max. Advance (days)", sk: "Max. vopred (dni)" },
					required: true,
				}),
				slotDurationMinutes: f.number({
					label: { en: "Slot Duration (min)", sk: "Trvanie slotu (min)" },
					required: true,
				}),
				allowCancellation: f.boolean({
					label: { en: "Allow Cancellation", sk: "Povoliť zrušenie" },
					required: true,
				}),
				cancellationDeadlineHours: f.number({
					label: {
						en: "Cancellation Deadline (hours)",
						sk: "Lehota na zrušenie (hodiny)",
					},
					required: true,
				}),
			},
		}),

		socialLinks: f.array({
			label: { en: "Social Links", sk: "Sociálne siete" },
			default: [
				{ platform: "instagram", url: "https://instagram.com/sharpcuts" },
				{ platform: "facebook", url: "https://facebook.com/sharpcuts" },
			] satisfies SocialLink[],
			of: f.object({
				fields: {
					platform: f.select({
						label: { en: "Platform", sk: "Platforma" },
						options: [
							{ value: "instagram", label: "Instagram" },
							{ value: "facebook", label: "Facebook" },
							{ value: "twitter", label: "Twitter" },
							{ value: "tiktok", label: "TikTok" },
							{ value: "youtube", label: "YouTube" },
						],
						required: true,
					}),
					url: f.url({
						label: { en: "URL", sk: "URL" },
						required: true,
					}),
				},
			}),
		}),

		metaTitle: f.text({
			label: { en: "Meta Title", sk: "Meta názov" },
			default: "Sharp Cuts - Premium Barbershop",
			localized: true,
		}),
		metaDescription: f.textarea({
			label: { en: "Meta Description", sk: "Meta popis" },
			default:
				"Professional barbershop services - haircuts, beard grooming, and more.",
			localized: true,
		}),
	}))
	.admin(({ c }) => ({
		label: { en: "Site Settings", sk: "Nastavenia webu" },
		icon: c.icon("ph:gear"),
	}))
	.form(({ v, f }) =>
		v.form({
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
		update: ({ session }) => (session?.user as any)?.role === "admin",
	});
