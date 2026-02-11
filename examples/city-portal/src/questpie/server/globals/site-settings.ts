/**
 * Site Settings Global (Scoped per City)
 *
 * Each city has its own site settings instance containing branding,
 * navigation, contact info, and SEO configuration.
 */

import { qb } from "@/questpie/server/builder";

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
	platform: "facebook" | "twitter" | "instagram" | "linkedin" | "youtube";
	url: string;
};

export const siteSettings = qb
	.global("site_settings")
	.fields((f) => ({
		// Branding
		siteName: f.text({
			label: "Site Name",
			required: true,
			default: "City Council",
			description: "Displayed in header and browser title",
		}),
		tagline: f.text({
			label: "Tagline",
			default: "Working for our community",
		}),
		logo: f.upload({
			label: "Site Logo",
			accept: ["image/*"],
		}),
		favicon: f.upload({
			label: "Favicon",
			accept: ["image/x-icon", "image/png"],
		}),

		// Colours
		primaryColour: f.text({
			label: "Primary Colour",
			default: "#1e40af",
			description: "Hex colour code for primary brand colour",
		}),
		secondaryColour: f.text({
			label: "Secondary Colour",
			default: "#64748b",
		}),

		// Navigation
		navigation: f.array({
			label: "Main Navigation",
			default: [
				{ label: "Home", href: "/" },
				{ label: "News", href: "/news" },
				{ label: "Services", href: "/services" },
				{ label: "Contact", href: "/contact" },
			] satisfies NavItem[],
			of: f.object({
				fields: {
					label: f.text({
						label: "Label",
						required: true,
					}),
					href: f.text({
						label: "URL",
						required: true,
					}),
					isExternal: f.boolean({
						label: "External Link",
						default: false,
					}),
				},
			}),
		}),

		// Footer
		footerText: f.textarea({
			label: "Footer Text",
			default: "Your local council, working for you.",
		}),
		footerLinks: f.array({
			label: "Footer Links",
			default: [
				{ label: "Privacy Policy", href: "/privacy" },
				{ label: "Accessibility", href: "/accessibility" },
				{ label: "Contact Us", href: "/contact" },
			] satisfies FooterLink[],
			of: f.object({
				fields: {
					label: f.text({
						label: "Label",
						required: true,
					}),
					href: f.text({
						label: "URL",
						required: true,
					}),
					isExternal: f.boolean({
						label: "External Link",
						default: false,
					}),
				},
			}),
		}),
		copyrightText: f.text({
			label: "Copyright Text",
			default: "City Council. All rights reserved.",
		}),

		// Social Links
		socialLinks: f.array({
			label: "Social Media Links",
			default: [] as SocialLink[],
			of: f.object({
				fields: {
					platform: f.select({
						label: "Platform",
						options: [
							{ value: "facebook", label: "Facebook" },
							{ value: "twitter", label: "Twitter/X" },
							{ value: "instagram", label: "Instagram" },
							{ value: "linkedin", label: "LinkedIn" },
							{ value: "youtube", label: "YouTube" },
						],
						required: true,
					}),
					url: f.url({
						label: "URL",
						required: true,
					}),
				},
			}),
		}),

		// Contact
		contactEmail: f.email({
			label: "Contact Email",
			default: "enquiries@council.gov.uk",
		}),
		contactPhone: f.text({
			label: "Contact Phone",
			default: "+44 20 7123 4567",
		}),
		address: f.textarea({
			label: "Address",
			default: "Council House\nCity Centre\nPostcode",
		}),
		emergencyPhone: f.text({
			label: "Emergency Phone",
			description: "Out of hours emergency contact",
		}),

		// Opening Hours
		openingHours: f.textarea({
			label: "Opening Hours",
			default: "Monday - Friday: 9:00 - 17:00\nSaturday - Sunday: Closed",
		}),

		// SEO
		metaTitle: f.text({
			label: "Meta Title",
			default: "City Council - Official Website",
		}),
		metaDescription: f.textarea({
			label: "Meta Description",
			default:
				"Official website of the City Council. Find information about local services, news, and how to contact us.",
		}),
		ogImage: f.upload({
			label: "Social Share Image",
			accept: ["image/*"],
			description: "Image shown when sharing pages on social media",
		}),

		// Analytics
		googleAnalyticsId: f.text({
			label: "Google Analytics ID",
			description: "e.g., G-XXXXXXXXXX",
		}),

		// Alerts
		alertEnabled: f.boolean({
			label: "Show Alert Banner",
			default: false,
		}),
		alertMessage: f.textarea({
			label: "Alert Message",
			description: "Shown at the top of every page when enabled",
		}),
		alertType: f.select({
			label: "Alert Type",
			options: [
				{ value: "info", label: "Information" },
				{ value: "warning", label: "Warning" },
				{ value: "emergency", label: "Emergency" },
			],
			default: "info",
		}),
		alertLink: f.text({
			label: "Alert Link",
			description: "Optional link for more information",
		}),
	}))
	.admin(({ c }) => ({
		label: "Site Settings",
		icon: c.icon("ph:gear"),
		description: "Configure site branding, navigation, and contact details",
	}))
	.form(({ v, f }) =>
		v.form({
			fields: [
				{
					type: "section",
					label: "Branding",
					layout: "grid",
					columns: 2,
					fields: [
						f.siteName,
						f.tagline,
						f.logo,
						f.favicon,
						f.primaryColour,
						f.secondaryColour,
					],
				},
				{
					type: "section",
					label: "Navigation",
					fields: [f.navigation],
				},
				{
					type: "section",
					label: "Footer",
					fields: [f.footerText, f.footerLinks, f.copyrightText],
				},
				{
					type: "section",
					label: "Social Media",
					fields: [f.socialLinks],
				},
				{
					type: "section",
					label: "Contact Information",
					layout: "grid",
					columns: 2,
					fields: [
						f.contactEmail,
						f.contactPhone,
						f.emergencyPhone,
						f.address,
						f.openingHours,
					],
				},
				{
					type: "section",
					label: "SEO",
					layout: "grid",
					columns: 2,
					fields: [f.metaTitle, f.metaDescription, f.ogImage],
				},
				{
					type: "section",
					label: "Analytics",
					fields: [f.googleAnalyticsId],
				},
				{
					type: "section",
					label: "Alert Banner",
					layout: "grid",
					columns: 2,
					fields: [f.alertEnabled, f.alertType, f.alertMessage, f.alertLink],
				},
			],
		}),
	)
	.options({
		timestamps: true,
		versioning: true,
		scoped: (ctx) => ctx.cityId,
	});
