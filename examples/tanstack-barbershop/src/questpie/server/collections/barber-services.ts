import { qb } from "@/questpie/server/builder";
import { barbers } from "@/questpie/server/collections/barbers";
import { services } from "@/questpie/server/collections/services";

export const barberServices = qb.collection("barber_services").fields((f) => ({
	barber: f.relation({
		to: () => barbers,
		required: true,
		onDelete: "cascade",
	}),
	service: f.relation({
		to: () => services,
		required: true,
		onDelete: "cascade",
	}),
}));
