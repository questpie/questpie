import { collection } from "#questpie/factories";

export const productionOrders = collection("productionOrders")
	.fields(({ f }) => ({
		orderNo: f.text(64).label("Order no.").required(),
		toy: f.relation("toys").label("Toy").required(),
		customerEmail: f.email().label("Customer email"),
		quantity: f.number().label("Quantity").required().default(100),
		priority: f
			.select([
				{ value: "normal", label: "Normal" },
				{ value: "rush", label: "Rush" },
				{ value: "hold", label: "Hold" },
			])
			.label("Priority")
			.required()
			.default("normal"),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "planning", label: "Planning" },
				{ value: "waiting-materials", label: "Waiting for materials" },
				{ value: "scheduled", label: "Scheduled" },
				{ value: "in-production", label: "In production" },
				{ value: "completed", label: "Completed" },
				{ value: "cancelled", label: "Cancelled" },
			])
			.label("Status")
			.required()
			.default("draft"),
		materialStatus: f
			.select([
				{ value: "unknown", label: "Unknown" },
				{ value: "available", label: "Available" },
				{ value: "shortage", label: "Shortage" },
			])
			.label("Material status")
			.required()
			.default("unknown"),
		dueDate: f.date().label("Due date").required(),
		plannedStart: f.datetime().label("Planned start"),
		plannedFinish: f.datetime().label("Planned finish"),
		notes: f.textarea().label("Notes"),
	}))
	.title(({ f }) => f.orderNo)
	.admin(({ c }) => ({
		label: "Production Orders",
		icon: c.icon("ph:clipboard-text"),
	}))
	.list(({ v, f }) =>
		v.collectionTable({
			columns: [
				f.orderNo,
				f.toy,
				f.quantity,
				f.priority,
				f.status,
				f.materialStatus,
				f.dueDate,
			],
			defaultSort: { field: f.dueDate, direction: "asc" },
		}),
	)
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status, f.materialStatus, f.priority],
			},
			fields: [
				{
					type: "section",
					label: "Order",
					layout: "grid",
					columns: 2,
					fields: [f.orderNo, f.toy, f.customerEmail, f.quantity, f.dueDate],
				},
				{
					type: "section",
					label: "Schedule",
					layout: "grid",
					columns: 2,
					fields: [f.plannedStart, f.plannedFinish],
				},
				{
					type: "section",
					label: "Notes",
					fields: [f.notes],
				},
			],
		}),
	)
	.access({
		read: true,
		create: true,
		// Cycle-regression fixture: this rule's helper lives in a file imported
		// BY this collection and uses the package-level AccessContext — must
		// typecheck without TS2456 (see lib/access.ts header).
		update: async (ctx) => {
			return !!ctx.data;
		},
		delete: true,
	})
	.hooks({
		afterChange: async ({ data, operation, queue }) => {
			if (operation !== "create") return;
			await queue.recalculateMaterialPlan.publish({ orderId: data.id });
		},
	});
