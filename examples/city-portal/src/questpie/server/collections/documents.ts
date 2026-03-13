/**
 * Documents Collection (Scoped)
 *
 * Official documents, policies, and publications.
 */

import { collection } from "#questpie/factories";

export default collection("documents")
	.fields(({ f }) => ({
		city: f.relation("cities").label("City").required(),
		title: f.text(255).label("Title").required(),
		description: f.textarea().label("Description"),
		category: f
			.select([
				{ value: "policy", label: "Policy" },
				{ value: "minutes", label: "Meeting Minutes" },
				{ value: "budget", label: "Budget & Finance" },
				{ value: "planning", label: "Planning" },
				{ value: "strategy", label: "Strategy" },
				{ value: "report", label: "Report" },
				{ value: "form", label: "Form" },
				{ value: "guide", label: "Guide" },
				{ value: "other", label: "Other" },
			])
			.label("Category")
			.required()
			.default("other"),
		file: f
			.upload({
				mimeTypes: [
					"application/pdf",
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				],
			})
			.label("File")
			.required(),
		publishedDate: f.date().label("Published Date"),
		version: f
			.text(50)
			.label("Version")
			.description("Document version (e.g., v1.0, 2024 Edition)"),
		isPublished: f.boolean().label("Published").default(true),
	}))
	.title(({ f }) => f.title)
	.admin(({ c }) => ({
		label: "Documents",
		icon: c.icon("ph:file-pdf"),
		description: "Official documents and publications",
	}))
	.list(({ v }) =>
		v.collectionTable({
			columns: ["title", "category", "publishedDate", "isPublished"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
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
