/**
 * Contacts Collection (Scoped)
 *
 * Contact information for city departments and services.
 */

import { qb } from "@/questpie/server/builder";

export const contacts = qb
	.collection("contacts")
	.fields((f) => ({
		city: f.relation({
			label: "City",
			to: "cities",
			required: true,
		}),
		department: f.text({
			label: "Department",
			required: true,
			maxLength: 255,
		}),
		description: f.textarea({
			label: "Description",
			description: "What this department handles",
		}),
		contactPerson: f.text({
			label: "Contact Person",
			maxLength: 255,
		}),
		position: f.text({
			label: "Position",
			maxLength: 255,
		}),
		email: f.text({
			label: "Email",
			maxLength: 255,
		}),
		phone: f.text({
			label: "Phone",
			maxLength: 50,
		}),
		address: f.textarea({
			label: "Address",
			description: "If different from main city address",
		}),
		officeHours: f.text({
			label: "Office Hours",
			maxLength: 255,
			description: "e.g., Mon-Fri 9:00-17:00",
		}),
		order: f.number({
			label: "Display Order",
			default: 0,
		}),
	}))
	.title(({ f }) => f.department)
	.admin(({ c }) => ({
		label: "Contacts",
		icon: c.icon("ph:address-book"),
		description: "Department contacts and information",
	}))
	.list(({ v }) =>
		v.table({
			columns: ["department", "contactPerson", "email", "phone"],
		}),
	)
	.form(({ v, f }) =>
		v.form({
			sidebar: {
				position: "right",
				fields: [f.city, f.order],
			},
			fields: [
				{
					type: "section",
					label: "Department Info",
					layout: "grid",
					columns: 2,
					fields: [f.department, f.description],
				},
				{
					type: "section",
					label: "Contact Person",
					layout: "grid",
					columns: 2,
					fields: [f.contactPerson, f.position],
				},
				{
					type: "section",
					label: "Contact Details",
					layout: "grid",
					columns: 2,
					fields: [f.email, f.phone, f.officeHours, f.address],
				},
			],
		}),
	);
