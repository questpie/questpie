/**
 * Contacts Collection (Scoped)
 *
 * Contact information for city departments and services.
 */

import { collection } from "#questpie/factories";

export default collection("contacts")
	.fields(({ f }) => ({
		city: f.relation("cities").label("City").required(),
		department: f.text(255).label("Department").required(),
		description: f
			.textarea()
			.label("Description")
			.description("What this department handles"),
		contactPerson: f.text(255).label("Contact Person"),
		position: f.text(255).label("Position"),
		email: f.text(255).label("Email"),
		phone: f.text(50).label("Phone"),
		address: f
			.textarea()
			.label("Address")
			.description("If different from main city address"),
		officeHours: f
			.text(255)
			.label("Office Hours")
			.description("e.g., Mon-Fri 9:00-17:00"),
		order: f.number().label("Display Order").default(0),
	}))
	.title(({ f }) => f.department)
	.admin(({ c }) => ({
		label: "Contacts",
		icon: c.icon("ph:address-book"),
		description: "Department contacts and information",
	}))
	.list(({ v }) =>
		v.collectionTable({
			columns: ["department", "contactPerson", "email", "phone"],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
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
