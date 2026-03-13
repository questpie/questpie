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
		isActive: f
			.boolean()
			.label({ en: "Active", sk: "Aktívna" })
			.default(true)
			.required(),
		barbers: f
			.relation("barbers")
			.manyToMany({
				through: "barberServices",
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
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.isActive, f.image],
			},
			fields: [
				{
					type: "section",
					label: { en: "Service Info", sk: "Informácie o službe" },
					layout: "grid",
					columns: 2,
					fields: [f.name, f.duration, f.price],
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
