import { route } from "questpie/services";
import { z } from "zod";

export default route()
	.post()
	.schema(
		z.object({
			days: z.number().int().positive().max(60).default(14),
		}),
	)
	.handler(async ({ input, collections }) => {
		const until = new Date();
		until.setDate(until.getDate() + input.days);

		const orders = await collections.productionOrders.find(
			{
				where: {
					dueDate: { lte: until },
					status: { in: ["planning", "waiting-materials", "scheduled"] },
				},
				limit: 500,
			},
			{ accessMode: "system" },
		);
		const machines = await collections.machines.find(
			{
				where: { status: "available" },
				limit: 100,
			},
			{ accessMode: "system" },
		);

		return {
			horizonDays: input.days,
			openOrders: orders.docs.length,
			totalUnits: orders.docs.reduce(
				(sum: number, order: { quantity?: unknown }) =>
					sum + Number(order.quantity ?? 0),
				0,
			),
			availableMachines: machines.docs.length,
		};
	});
