import { collection } from "#questpie/factories";

export const operations = collection("operations")
	.fields(({ f }) => ({
		productionOrder: f
			.relation("productionOrders")
			.label("Production order")
			.required(),
		machine: f.relation("machines").label("Machine").required(),
		sequence: f.number().label("Sequence").required().default(10),
		name: f.text(255).label("Operation").required(),
		status: f
			.select([
				{ value: "queued", label: "Queued" },
				{ value: "running", label: "Running" },
				{ value: "done", label: "Done" },
				{ value: "blocked", label: "Blocked" },
			])
			.label("Status")
			.required()
			.default("queued"),
		plannedStart: f.datetime().label("Planned start"),
		plannedFinish: f.datetime().label("Planned finish"),
		actualStart: f.datetime().label("Actual start"),
		actualFinish: f.datetime().label("Actual finish"),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: "Operations",
		icon: c.icon("ph:flow-arrow"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.productionOrder,
				f.sequence,
				f.name,
				f.machine,
				f.status,
				f.plannedStart,
			],
			defaultSort: { field: f.sequence, direction: "asc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status, f.sequence],
			},
			fields: [
				{
					type: "section",
					label: "Operation",
					layout: "grid",
					columns: 2,
					fields: [f.productionOrder, f.machine, f.name],
				},
				{
					type: "section",
					label: "Timing",
					layout: "grid",
					columns: 2,
					fields: [
						f.plannedStart,
						f.plannedFinish,
						f.actualStart,
						f.actualFinish,
					],
				},
			],
		}),
	);
