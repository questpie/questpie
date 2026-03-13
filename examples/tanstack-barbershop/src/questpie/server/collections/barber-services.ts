import { collection } from "#questpie/factories";
import { barbers } from "@/questpie/server/collections/barbers";
import { services } from "@/questpie/server/collections/services";

export const barberServices = collection("barber_services")
	.fields(({ f }) => ({
		barber: f
			.relation(() => barbers)
			.required()
			.onDelete("cascade")
			.label({ en: "Barber", sk: "Holič" }),
		service: f
			.relation(() => services)
			.required()
			.onDelete("cascade")
			.label({ en: "Service", sk: "Služba" }),
	}))
	.admin(({ c }) => ({
		label: { en: "Barber Services", sk: "Služby holičov" },
		icon: c.icon("ph:link"),
		hidden: true,
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: { en: "Assignment", sk: "Priradenie" },
					layout: "grid",
					columns: 2,
					fields: [f.barber, f.service],
				},
			],
		}),
	);
