import { collection } from "#questpie/factories";

export const machines = collection("machines")
	.fields(({ f }) => ({
		name: f.text(255).label("Name").required(),
		code: f.text(64).label("Code").required(),
		station: f
			.select([
				{ value: "cutting", label: "Cutting" },
				{ value: "painting", label: "Painting" },
				{ value: "assembly", label: "Assembly" },
				{ value: "packing", label: "Packing" },
			])
			.label("Station")
			.required(),
		hourlyCapacity: f.number().label("Units per hour").required().default(30),
		status: f
			.select([
				{ value: "available", label: "Available" },
				{ value: "maintenance", label: "Maintenance" },
				{ value: "offline", label: "Offline" },
			])
			.label("Status")
			.required()
			.default("available"),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: "Machines",
		icon: c.icon("ph:factory"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [f.name, f.code, f.station, f.hourlyCapacity, f.status],
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			fields: [
				{
					type: "section",
					label: "Machine",
					layout: "grid",
					columns: 2,
					fields: [f.name, f.code, f.station, f.status],
				},
				{
					type: "section",
					label: "Capacity",
					fields: [f.hourlyCapacity],
				},
			],
		}),
	);
