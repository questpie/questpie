/**
 * Submissions Collection (Scoped)
 *
 * Contact form submissions from the public website.
 */

import { qb } from "@/questpie/server/builder";

export const submissions = qb
	.collection("submissions")
	.fields((f) => ({
		city: f.relation({
			label: "City",
			to: "cities",
			required: true,
		}),
		name: f.text({
			label: "Name",
			required: true,
			maxLength: 255,
		}),
		email: f.text({
			label: "Email",
			required: true,
			maxLength: 255,
		}),
		phone: f.text({
			label: "Phone",
			maxLength: 50,
		}),
		subject: f.text({
			label: "Subject",
			required: true,
			maxLength: 255,
		}),
		message: f.textarea({
			label: "Message",
			required: true,
		}),
		department: f.select({
			label: "Department",
			options: [
				{ value: "general", label: "General Enquiry" },
				{ value: "planning", label: "Planning" },
				{ value: "housing", label: "Housing" },
				{ value: "environment", label: "Environment" },
				{ value: "council-tax", label: "Council Tax" },
				{ value: "benefits", label: "Benefits" },
				{ value: "parking", label: "Parking" },
				{ value: "waste", label: "Waste & Recycling" },
				{ value: "other", label: "Other" },
			],
			default: "general",
		}),
		status: f.select({
			label: "Status",
			options: [
				{ value: "new", label: "New" },
				{ value: "in-progress", label: "In Progress" },
				{ value: "resolved", label: "Resolved" },
				{ value: "closed", label: "Closed" },
			],
			default: "new",
			required: true,
		}),
		notes: f.textarea({
			label: "Internal Notes",
			description: "Notes for internal use only",
		}),
	}))
	.title(({ f }) => f.subject)
	.admin(({ c }) => ({
		label: "Submissions",
		icon: c.icon("ph:envelope"),
		description: "Contact form submissions",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["name", "subject", "department", "status", "createdAt"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
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
