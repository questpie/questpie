import { qb } from "@/questpie/server/builder";

export const reviews = qb
	.collection("reviews")
	.fields((f) => ({
		// Customer relation - when set, use customer's name and email
		customer: f.relation({
			to: "user",
			label: { en: "Customer", sk: "Zákazník" },
		}),
		customerName: f.text({
			label: { en: "Customer Name", sk: "Meno zákazníka" },
			required: true,
			maxLength: 255,
		}),
		customerEmail: f.email({
			label: { en: "Customer Email", sk: "Email zákazníka" },
			maxLength: 255,
		}),
		barber: f.relation({
			to: "barbers",
			required: true,
			label: { en: "Barber", sk: "Holič" },
		}),
		appointment: f.relation({
			to: "appointments",
			label: { en: "Appointment", sk: "Rezervácia" },
		}),
		rating: f.select({
			required: true,
			label: { en: "Rating", sk: "Hodnotenie" },
			options: [
				{ value: "1", label: { en: "1 Star", sk: "1 Hviezdička" } },
				{ value: "2", label: { en: "2 Stars", sk: "2 Hviezdičky" } },
				{ value: "3", label: { en: "3 Stars", sk: "3 Hviezdičky" } },
				{ value: "4", label: { en: "4 Stars", sk: "4 Hviezdičky" } },
				{ value: "5", label: { en: "5 Stars", sk: "5 Hviezdičiek" } },
			],
		}),
		comment: f.textarea({
			label: { en: "Comment", sk: "Komentár" },
			localized: true,
		}),
		isApproved: f.boolean({
			label: { en: "Approved", sk: "Schválené" },
			default: false,
			required: true,
		}),
		// Featured option only available for approved reviews
		isFeatured: f.boolean({
			label: { en: "Featured", sk: "Odporúčané" },
			default: false,
			required: true,
		}),
	}))
	.title(({ f }) => f.customerName)
	.admin(({ c }) => ({
		label: { en: "Reviews", sk: "Recenzie" },
		icon: c.icon("ph:star"),
	}))
	.list(({ v }) => v.table({}))
	.form(({ v, f }) =>
		v.form({
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
