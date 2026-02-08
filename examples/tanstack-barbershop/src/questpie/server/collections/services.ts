import { qb } from "@/questpie/server/builder";

export const services = qb
	.collection("services")
	.fields((f) => ({
		name: f.text({ required: true, maxLength: 255, localized: true }),
		description: f.textarea({ localized: true }),
		image: f.upload({ to: "assets" }),
		duration: f.number({ required: true }),
		price: f.number({ required: true }),
		isActive: f.boolean({ default: true, required: true }),
		barbers: f.relation({
			to: "barbers",
			hasMany: true,
			through: "barberServices",
			sourceField: "service",
			targetField: "barber",
		}),
	}))
	.title(({ f }) => f.name);
