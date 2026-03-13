/**
 * Announcements Collection (Scoped)
 *
 * Official notices and announcements with validity periods.
 */

import { collection } from "#questpie/factories";

export default collection("announcements")
	.fields(({ f }) => ({
		city: f.relation("cities").label("City").required(),
		title: f.text(255).label("Title").required(),
		content: f.richText().label("Content"),
		category: f
			.select([
				{ value: "notice", label: "Public Notice" },
				{ value: "planning", label: "Planning Application" },
				{ value: "consultation", label: "Public Consultation" },
				{ value: "tender", label: "Tender" },
				{ value: "job", label: "Job Vacancy" },
				{ value: "event", label: "Event" },
				{ value: "emergency", label: "Emergency Notice" },
			])
			.label("Category")
			.required()
			.default("notice"),
		validFrom: f.date().label("Valid From").required(),
		validTo: f
			.date()
			.label("Valid Until")
			.required()
			.description("Announcement will be hidden after this date"),
		isPinned: f
			.boolean()
			.label("Pinned")
			.default(false)
			.description("Show at the top of the list"),
		attachments: f
			.upload({ mimeTypes: ["application/pdf", "image/*"] })
			.label("Attachments")
			.multiple(),
		referenceNumber: f
			.text(100)
			.label("Reference Number")
			.description("Official reference number"),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Announcements",
		icon: c.icon("ph:megaphone"),
		description: "Official notices and public announcements",
	}))
	.list(({ v }) =>
		v.collectionTable({
			columns: ["title", "category", "validFrom", "validTo", "isPinned"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [
					f.city,
					f.category,
					f.validFrom,
					f.validTo,
					f.isPinned,
					f.referenceNumber,
				],
			},
			fields: [
				{
					type: "section",
					label: "Announcement",
					fields: [f.title, f.content, f.attachments],
				},
			],
		}),
	);
