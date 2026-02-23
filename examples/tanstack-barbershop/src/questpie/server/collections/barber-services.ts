import { collection } from "questpie";
import { barbers } from "@/questpie/server/collections/barbers";
import { services } from "@/questpie/server/collections/services";

export const barberServices = collection("barber_services")
	.fields(({ f }) => ({
		barber: f.relation({
			to: () => barbers,
			required: true,
			onDelete: "cascade",
			label: { en: "Barber", sk: "Holič" },
		}),
		service: f.relation({
			to: () => services,
			required: true,
			onDelete: "cascade",
			label: { en: "Service", sk: "Služba" },
		}),
	}))
	.admin(({ c }) => ({
		label: { en: "Barber Services", sk: "Služby holičov" },
		icon: c.icon("ph:link"),
		hidden: true,
	}))
	.list(({ v }) => v.table({}))
	.form(({ v, f }) =>
		v.form({
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
