import { collection } from "#questpie/factories";

export const reviews = collection("reviews")
	.fields(({ f }) => ({
		// Customer relation - when set, use customer's name and email
		customer: f.relation("user").label({ en: "Customer", sk: "Zákazník" }),
		customerName: f
			.text(255)
			.label({ en: "Customer Name", sk: "Meno zákazníka" })
			.required(),
		customerEmail: f
			.email(255)
			.label({ en: "Customer Email", sk: "Email zákazníka" }),
		barber: f
			.relation("barbers")
			.required()
			.label({ en: "Barber", sk: "Holič" }),
		appointment: f
			.relation("appointments")
			.label({ en: "Appointment", sk: "Rezervácia" }),
		// Custom app-land field type (server/fields/rating.ts + the star UI in
		// admin/fields/rating.tsx). Same varchar column as the select it
		// replaced — no migration.
		rating: f.rating().required().label({ en: "Rating", sk: "Hodnotenie" }),
		comment: f.textarea().label({ en: "Comment", sk: "Komentár" }).localized(),
		isApproved: f
			.boolean()
			.label({ en: "Approved", sk: "Schválené" })
			.default(false)
			.required(),
		// Featured option only available for approved reviews
		isFeatured: f
			.boolean()
			.label({ en: "Featured", sk: "Odporúčané" })
			.default(false)
			.required(),
	}))
	.title(({ f }) => f.customerName)
	.admin(({ c }) => ({
		label: { en: "Reviews", sk: "Recenzie" },
		icon: c.icon("ph:star"),
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [
					f.isApproved,
					{
						field: f.isFeatured,
						hidden: ({ data }) => !data.isApproved,
						compute: {
							handler: ({ data }) => (!data.isApproved ? false : undefined),
							deps: ({ data }) => [data.isApproved],
						},
					},
					f.rating,
				],
			},
			fields: [
				{
					type: "section",
					label: { en: "Customer", sk: "Zákazník" },
					layout: "grid",
					columns: 2,
					fields: [
						f.customer,
						{
							field: f.customerName,
							readOnly: ({ data }) => !!data.customer,
						},
						{
							field: f.customerEmail,
							hidden: ({ data }) => !!data.customer,
						},
					],
				},
				{
					type: "section",
					label: { en: "Review Details", sk: "Detaily recenzie" },
					fields: [f.barber, f.appointment, f.comment],
				},
			],
		}),
	);
