/**
 * Submissions Collection (Scoped)
 *
 * Contact form submissions from the public website.
 */

import { collection } from "#questpie/factories";

export default collection("submissions")
	.fields(({ f }) => ({
		city: f.relation("cities").label("City").required(),
		name: f.text(255).label("Name").required(),
		email: f.text(255).label("Email").required(),
		phone: f.text(50).label("Phone"),
		subject: f.text(255).label("Subject").required(),
		message: f.textarea().label("Message").required(),
		department: f
			.select([
				{ value: "general", label: "General Enquiry" },
				{ value: "planning", label: "Planning" },
				{ value: "housing", label: "Housing" },
				{ value: "environment", label: "Environment" },
				{ value: "council-tax", label: "Council Tax" },
				{ value: "benefits", label: "Benefits" },
				{ value: "parking", label: "Parking" },
				{ value: "waste", label: "Waste & Recycling" },
				{ value: "other", label: "Other" },
			])
			.label("Department")
			.default("general"),
		status: f
			.select([
				{ value: "new", label: "New" },
				{ value: "in-progress", label: "In Progress" },
				{ value: "resolved", label: "Resolved" },
				{ value: "closed", label: "Closed" },
			])
			.label("Status")
			.default("new")
			.required(),
		notes: f
			.textarea()
			.label("Internal Notes")
			.description("Notes for internal use only"),
	}))
	.title(({ f }) => f.subject)
	.admin(({ c }) => ({
		label: "Submissions",
		icon: c.icon("ph:envelope"),
		description: "Contact form submissions",
	}))
	.list(({ v }) =>
		v.collectionTable({
			columns: ["name", "subject", "department", "status", "createdAt"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.city, f.status, f.department],
			},
			fields: [
				{
					type: "section",
					label: "Contact Information",
					layout: "grid",
					columns: 3,
					fields: [f.name, f.email, f.phone],
				},
				{
					type: "section",
					label: "Message",
					fields: [f.subject, f.message],
				},
				{
					type: "section",
					label: "Internal",
					fields: [f.notes],
				},
			],
		}),
	);
