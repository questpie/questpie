import { uniqueIndex } from "questpie/drizzle-pg-core";
import { collection } from "#questpie/factories";
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

export const barbers = collection("barbers")
	.fields(({ f }) => {
		const daySchedule = () => ({
			isOpen: f
				.boolean()
				.label({ en: "Open", sk: "Otvorené" })
				.default(true)
				.admin({ displayAs: "switch" }),
			start: f
				.time()
				.label({ en: "Start", sk: "Začiatok" })
				.admin({ placeholder: "09:00" }),
			end: f
				.time()
				.label({ en: "End", sk: "Koniec" })
				.admin({ placeholder: "17:00" }),
		});

		return {
			name: f
				.text(255)
				.label({ en: "Full Name", sk: "Celé meno" })
				.admin({ placeholder: "John Doe" })
				.required(),
			slug: f
				.text(255)
				.label({ en: "Slug", sk: "Slug" })
				.description({
					en: "URL-friendly identifier (auto-generated from name)",
					sk: "URL-friendly identifikátor (auto-generovaný z mena)",
				})
				.required()
				.inputOptional(),
			email: f
				.email(255)
				.label({ en: "Email Address", sk: "Emailová adresa" })
				.admin({ placeholder: "barber@example.com" })
				.required(),
			phone: f
				.text(50)
				.label({ en: "Phone Number", sk: "Telefónne číslo" })
				.admin({ placeholder: "+1 (555) 000-0000" }),
			bio: f
				.richText()
				.label({ en: "Biography", sk: "Životopis" })
				.description({
					en: "A short description about the barber (supports rich formatting)",
					sk: "Krátky popis o holičovi (podporuje formátovanie)",
				})
				.localized(),
			avatar: f
				.upload({
					to: "assets",
					mimeTypes: ["image/*"],
					maxSize: 5_000_000,
				})
				.label({ en: "Profile Photo", sk: "Profilová fotka" })
				.admin({ accept: "image/*", previewVariant: "compact" }),
			isActive: f
				.boolean()
				.label({ en: "Active", sk: "Aktívny" })
				.description({
					en: "Whether this barber is currently available for appointments",
					sk: "Či je holič aktuálne dostupný na objednávky",
				})
				.default(true)
				.required()
				.admin({ displayAs: "switch" }),
			workingHours: f
				.object({
					monday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Monday", sk: "Pondelok" })
						.admin({ layout: "inline" }),
					tuesday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Tuesday", sk: "Utorok" })
						.admin({ layout: "inline" }),
					wednesday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Wednesday", sk: "Streda" })
						.admin({ layout: "inline" }),
					thursday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Thursday", sk: "Štvrtok" })
						.admin({ layout: "inline" }),
					friday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Friday", sk: "Piatok" })
						.admin({ layout: "inline" }),
					saturday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Saturday", sk: "Sobota" })
						.admin({ layout: "inline" }),
					sunday: f
						.object({
							...daySchedule(),
						})
						.label({ en: "Sunday", sk: "Nedeľa" })
						.admin({ layout: "inline" }),
				})
				.label({ en: "Working Hours", sk: "Pracovná doba" })
				.description({
					en: "Set the working schedule for each day",
					sk: "Nastavte pracovný rozvrh pre každý deň",
				})
				.admin({ wrapper: "collapsible", layout: "grid" }),
			socialLinks: f
				.object({
					platform: f
						.select([
							{ value: "instagram", label: "Instagram" },
							{ value: "facebook", label: "Facebook" },
							{ value: "twitter", label: "Twitter" },
							{ value: "linkedin", label: "LinkedIn" },
							{ value: "tiktok", label: "TikTok" },
						])
						.label({ en: "Platform", sk: "Platforma" }),
					url: f
						.url()
						.label({ en: "URL", sk: "URL" })
						.admin({ placeholder: "https://..." }),
				})
				.label({ en: "Social Link", sk: "Sociálna sieť" })
				.array()
				.label({ en: "Social Links", sk: "Sociálne siete" })
				.description({
					en: "Add social media profiles",
					sk: "Pridajte profily na sociálnych sieťach",
				})
				.admin({
					orderable: true,
					mode: "inline",
					itemLabel: "Social link",
				})
				.maxItems(5),
			specialties: f
				.text()
				.label({ en: "Specialty", sk: "Špecializácia" })
				.array()
				.label({ en: "Specialties", sk: "Špecializácie" })
				.localized(),
			services: f
				.relation("services")
				.manyToMany({
					through: "barberServices",
					sourceField: "barber",
					targetField: "service",
				})
				.label({ en: "Services Offered", sk: "Ponúkané služby" })
				.description({
					en: "Select the services this barber can perform",
					sk: "Vyberte služby, ktoré holič poskytuje",
				})
				.admin({ displayAs: "table" }),
		};
	})
	.indexes(({ table }) => [
		uniqueIndex("barbers_slug_unique").on(table.slug),
		uniqueIndex("barbers_email_unique").on(table.email),
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
			const recordSlug =
				typeof record.slug === "string" ? record.slug.trim() : "";

			const slug =
				recordSlug ||
				(typeof record.name === "string" ? slugify(record.name) : "barber");

			return `/barbers/${slug}?preview=true`;
		},
	})
	.list(({ v, f }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
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
		beforeValidate: async (ctx) => {
			// Generate slug from name if not provided (for create or update)
			if (ctx.data.name && !ctx.data.slug) {
				ctx.data.slug = slugify(ctx.data.name);
			}
		},
	});
