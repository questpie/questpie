/**
 * Announcements Collection (Scoped)
 *
 * Official notices and announcements with validity periods.
 */

import { qb } from "@/questpie/server/builder";

export const announcements = qb
	.collection("announcements")
	.fields((f) => ({
		city: f.relation({
			label: "City",
			to: "cities",
			required: true,
		}),
		title: f.text({
			label: "Title",
			required: true,
			maxLength: 255,
		}),
		content: f.richText({
			label: "Content",
		}),
		category: f.select({
			label: "Category",
			options: [
				{ value: "notice", label: "Public Notice" },
				{ value: "planning", label: "Planning Application" },
				{ value: "consultation", label: "Public Consultation" },
				{ value: "tender", label: "Tender" },
				{ value: "job", label: "Job Vacancy" },
				{ value: "event", label: "Event" },
				{ value: "emergency", label: "Emergency Notice" },
			],
			required: true,
			default: "notice",
		}),
		validFrom: f.date({
			label: "Valid From",
			required: true,
		}),
		validTo: f.date({
			label: "Valid Until",
			required: true,
			description: "Announcement will be hidden after this date",
		}),
		isPinned: f.boolean({
			label: "Pinned",
			default: false,
			description: "Show at the top of the list",
		}),
		attachments: f.upload({
			label: "Attachments",
			accept: ["application/pdf", "image/*"],
			multiple: true,
		}),
		referenceNumber: f.text({
			label: "Reference Number",
			maxLength: 100,
			description: "Official reference number",
		}),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Announcements",
		icon: c.icon("ph:megaphone"),
		description: "Official notices and public announcements",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["title", "category", "validFrom", "validTo", "isPinned"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
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
