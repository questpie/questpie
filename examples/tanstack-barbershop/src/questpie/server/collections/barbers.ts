import { uniqueIndex } from "drizzle-orm/pg-core";
import { qb } from "@/questpie/server/builder";
import { slugify } from "@/questpie/server/utils";

export type DaySchedule = {
	isOpen: boolean;
	start: string;
	end: string;
};

export type WorkingHours = {
	monday: DaySchedule;
	tuesday: DaySchedule;
	wednesday: DaySchedule;
	thursday: DaySchedule;
	friday: DaySchedule;
	saturday?: DaySchedule | null;
	sunday?: DaySchedule | null;
};

export type SocialLink = {
	platform: "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok";
	url: string;
};

export const barbers = qb
	.collection("barbers")
	.fields((f) => {
		const daySchedule = () => ({
			isOpen: f.boolean({
				label: { en: "Open", sk: "Otvorené" },
				default: true,
				meta: { admin: { displayAs: "switch" } },
			}),
			start: f.time({
				label: { en: "Start", sk: "Začiatok" },
				meta: { admin: { placeholder: "09:00" } },
			}),
			end: f.time({
				label: { en: "End", sk: "Koniec" },
				meta: { admin: { placeholder: "17:00" } },
			}),
		});

		return {
			name: f.text({
				label: { en: "Full Name", sk: "Celé meno" },
				meta: { admin: { placeholder: "John Doe" } },
				required: true,
				maxLength: 255,
			}),
			slug: f.text({
				label: { en: "Slug", sk: "Slug" },
				description: {
					en: "URL-friendly identifier (auto-generated from name)",
					sk: "URL-friendly identifikátor (auto-generovaný z mena)",
				},
				required: true,
				maxLength: 255,
				input: "optional",
			}),
			email: f.email({
				label: { en: "Email Address", sk: "Emailová adresa" },
				meta: { admin: { placeholder: "barber@example.com" } },
				required: true,
				maxLength: 255,
			}),
			phone: f.text({
				label: { en: "Phone Number", sk: "Telefónne číslo" },
				meta: { admin: { placeholder: "+1 (555) 000-0000" } },
				maxLength: 50,
			}),
			bio: f.richText({
				label: { en: "Biography", sk: "Životopis" },
				description: {
					en: "A short description about the barber (supports rich formatting)",
					sk: "Krátky popis o holičovi (podporuje formátovanie)",
				},
				localized: true,
			}),
			avatar: f.upload({
				label: { en: "Profile Photo", sk: "Profilová fotka" },
				to: "assets",
				mimeTypes: ["image/*"],
				maxSize: 5_000_000,
				meta: {
					admin: { accept: "image/*", previewVariant: "compact" },
				},
			}),
			isActive: f.boolean({
				label: { en: "Active", sk: "Aktívny" },
				description: {
					en: "Whether this barber is currently available for appointments",
					sk: "Či je holič aktuálne dostupný na objednávky",
				},
				default: true,
				required: true,
				meta: { admin: { displayAs: "switch" } },
			}),
			workingHours: f.object({
				label: { en: "Working Hours", sk: "Pracovná doba" },
				description: {
					en: "Set the working schedule for each day",
					sk: "Nastavte pracovný rozvrh pre každý deň",
				},
				meta: { admin: { wrapper: "collapsible", layout: "grid" } },
				fields: () => ({
					monday: f.object({
						label: { en: "Monday", sk: "Pondelok" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					tuesday: f.object({
						label: { en: "Tuesday", sk: "Utorok" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					wednesday: f.object({
						label: { en: "Wednesday", sk: "Streda" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					thursday: f.object({
						label: { en: "Thursday", sk: "Štvrtok" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					friday: f.object({
						label: { en: "Friday", sk: "Piatok" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					saturday: f.object({
						label: { en: "Saturday", sk: "Sobota" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
					sunday: f.object({
						label: { en: "Sunday", sk: "Nedeľa" },
						meta: { admin: { layout: "inline" } },
						fields: daySchedule,
					}),
				}),
			}),
			socialLinks: f.array({
				label: { en: "Social Links", sk: "Sociálne siete" },
				description: {
					en: "Add social media profiles",
					sk: "Pridajte profily na sociálnych sieťach",
				},
				meta: {
					admin: {
						orderable: true,
						mode: "inline",
						itemLabel: "Social link",
					},
				},
				of: f.object({
					label: { en: "Social Link", sk: "Sociálna sieť" },
					fields: () => ({
						platform: f.select({
							label: { en: "Platform", sk: "Platforma" },
							options: [
								{ value: "instagram", label: "Instagram" },
								{ value: "facebook", label: "Facebook" },
								{ value: "twitter", label: "Twitter" },
								{ value: "linkedin", label: "LinkedIn" },
								{ value: "tiktok", label: "TikTok" },
							],
						}),
						url: f.url({
							label: { en: "URL", sk: "URL" },
							meta: { admin: { placeholder: "https://..." } },
						}),
					}),
				}),
				maxItems: 5,
			}),
			specialties: f.array({
				label: { en: "Specialties", sk: "Špecializácie" },
				of: f.text({ label: { en: "Specialty", sk: "Špecializácia" } }),
				localized: true,
			}),
			services: f.relation({
				to: "services",
				hasMany: true,
				through: "barberServices",
				sourceField: "barber",
				targetField: "service",
				label: { en: "Services Offered", sk: "Ponúkané služby" },
				description: {
					en: "Select the services this barber can perform",
					sk: "Vyberte služby, ktoré holič poskytuje",
				},
				meta: { admin: { displayAs: "table" } },
			}),
		};
	})
	.indexes(({ table }) => [
		uniqueIndex("barbers_slug_unique").on(table.slug as any),
		uniqueIndex("barbers_email_unique").on(table.email as any),
	])
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Barbers", sk: "Holiči" },
		icon: c.icon("ph:users"),
	}))
	.preview({
		enabled: true,
		position: "right",
		defaultWidth: 50,
		url: ({ record }) => {
			const name = record.name as string | undefined;
			const slug = name?.toLowerCase().replace(/\s+/g, "-") || "barber";
			return `/barbers/${slug}?preview=true`;
		},
	})
	.list(({ v }) => v.table({}))
	.form(({ v, f }) =>
		v.form({
			sidebar: {
				position: "right",
				fields: [f.isActive, f.avatar],
			},
			fields: [
				{
					type: "section",
					label: { en: "Contact Information", sk: "Kontaktné informácie" },
					layout: "grid",
					columns: 2,
					fields: [
						f.name,
						{
							field: f.slug,
							compute: {
								handler: ({ data }) => {
									if (
										data.name &&
										typeof data.name === "string" &&
										(!data.slug ||
											(typeof data.slug === "string" && !data.slug.trim()))
									) {
										return slugify(data.name);
									}

									return undefined;
								},
								deps: ({ data }) => [data.name, data.slug],
								debounce: 300,
							},
						},
						f.email,
						f.phone,
					],
				},
				{
					type: "section",
					label: { en: "Profile", sk: "Profil" },
					fields: [f.bio],
				},
				{
					type: "section",
					label: { en: "Services", sk: "Služby" },
					description: {
						en: "Services this barber offers",
						sk: "Služby, ktoré holič poskytuje",
					},
					fields: [f.services],
				},
				{
					type: "section",
					fields: [f.socialLinks],
				},
				{
					type: "section",
					fields: [f.workingHours],
				},
			],
		}),
	)
	.hooks({
		beforeValidate: async ({ data }) => {
			// Generate slug from name if not provided (for create or update)
			const d = data;
			if (d.name && !d.slug) {
				d.slug = slugify(d.name);
			}
		},
	});
