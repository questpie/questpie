/**
 * Documents Collection (Scoped)
 *
 * Official documents, policies, and publications.
 */

import { qb } from "@/questpie/server/builder";

export const documents = qb
	.collection("documents")
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
		description: f.textarea({
			label: "Description",
		}),
		category: f.select({
			label: "Category",
			options: [
				{ value: "policy", label: "Policy" },
				{ value: "minutes", label: "Meeting Minutes" },
				{ value: "budget", label: "Budget & Finance" },
				{ value: "planning", label: "Planning" },
				{ value: "strategy", label: "Strategy" },
				{ value: "report", label: "Report" },
				{ value: "form", label: "Form" },
				{ value: "guide", label: "Guide" },
				{ value: "other", label: "Other" },
			],
			required: true,
			default: "other",
		}),
		file: f.upload({
			label: "File",
			accept: [
				"application/pdf",
				"application/msword",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			],
			required: true,
		}),
		publishedDate: f.date({
			label: "Published Date",
		}),
		version: f.text({
			label: "Version",
			maxLength: 50,
			description: "Document version (e.g., v1.0, 2024 Edition)",
		}),
		isPublished: f.boolean({
			label: "Published",
			default: true,
		}),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Documents",
		icon: c.icon("ph:file-pdf"),
		description: "Official documents and publications",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["title", "category", "publishedDate", "isPublished"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
			sidebar: {
				position: "right",
				fields: [f.city, f.category, f.publishedDate, f.version, f.isPublished],
			},
			fields: [
				{
					type: "section",
					label: "Document",
					fields: [f.title, f.description, f.file],
				},
			],
		}),
	);
