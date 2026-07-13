import { collection } from "#questpie/factories";

export const services = collection("services")
	.fields(({ f }) => ({
		name: f.text(255).label({ en: "Name", sk: "Názov" }).required().localized(),
		description: f
			.textarea()
			.label({ en: "Description", sk: "Popis" })
			.localized(),
		image: f.upload({ to: "assets" }).label({ en: "Image", sk: "Obrázok" }),
		duration: f
			.number()
			.required()
			.label({ en: "Duration (minutes)", sk: "Trvanie (minúty)" }),
		price: f
			.number()
			.required()
			.label({ en: "Price (cents)", sk: "Cena (centy)" }),
		order: f
			.number()
			.default(0)
			.required()
			.label({ en: "Order", sk: "Poradie" }),
		isActive: f
			.boolean()
			.label({ en: "Active", sk: "Aktívna" })
			.default(true)
			.required(),
		// App-land custom field type (server/fields/color.ts + admin/fields/
		// color.tsx). Reactively hidden while the service is inactive — an
		// inactive service is never shown on the calendar, so its colour is
		// moot. Proves a custom `f.<name>()` field type AND a reactive
		// `.admin({ hidden })` on it, end-to-end.
		color: f
			.color()
			.label({ en: "Calendar colour", sk: "Farba v kalendári" })
			.admin({
				hidden: ({ data }: { data: { isActive?: boolean } }) => !data.isActive,
			}),
		barbers: f
			.relation("barbers")
			.manyToMany({
				through: "barber_services",
				sourceField: "service",
				targetField: "barber",
			})
			.label({ en: "Barbers Offering", sk: "Holiči poskytujúci" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Services", sk: "Služby" },
		icon: c.icon("ph:scissors"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.name, f.isActive, f.duration, f.price, f.order],
			defaultSort: { field: f.order, direction: "asc" },
			orderable: true,
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.isActive, f.order, f.image],
			},
			fields: [
				{
					type: "section",
					label: { en: "Service Info", sk: "Informácie o službe" },
					layout: "grid",
					columns: 2,
					fields: [f.name, f.duration, f.price, f.color],
				},
				{
					type: "section",
					label: { en: "Description", sk: "Popis" },
					fields: [f.description],
				},
				{
					type: "section",
					label: { en: "Barbers", sk: "Holiči" },
					fields: [f.barbers],
				},
			],
		}),
	);
