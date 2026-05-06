import { z } from "zod";

import { workflow } from "@questpie/workflows";

export default workflow({
	name: "production-order-plan",
	schema: z.object({
		orderId: z.string(),
	}),
	timeout: "5d",
	handler: async ({ input, step, ctx, log }) => {
		const order = await step.run("load-order", async () => {
			return ctx.collections.productionOrders.findOne({
				where: { id: input.orderId },
				with: { toy: true },
			});
		});

		if (!order) {
			throw new Error(`Production order not found: ${input.orderId}`);
		}

		await step.run("check-materials", async () => {
			await ctx.queue.recalculateMaterialPlan.publish({
				orderId: input.orderId,
			});
		});

		if (order.materialStatus !== "available") {
			await step.waitForEvent("wait-for-materials", {
				event: "production.materials-ready",
				match: { orderId: input.orderId },
				timeout: "3d",
			});
		}

		const schedule = await step.run("schedule-order", async () => {
			const minutesPerUnit =
				typeof order.toy === "object" &&
				order.toy &&
				"minutesPerUnit" in order.toy
					? Number(order.toy.minutesPerUnit ?? 12)
					: 12;
			const window = ctx.services.capacityPlanner.estimateOrderWindow({
				quantity: Number(order.quantity ?? 0),
				minutesPerUnit,
			});

			await ctx.collections.productionOrders.update({
				where: { id: input.orderId },
				data: {
					status: "scheduled",
					materialStatus: "available",
					plannedStart: window.plannedStart,
					plannedFinish: window.plannedFinish,
				},
			});

			return window;
		});

		await step.run("send-schedule-email", async () => {
			if (!order.customerEmail) return;
			await ctx.email.sendTemplate({
				template: "productionScheduled",
				to: order.customerEmail,
				input: {
					orderNo: order.orderNo,
					toyName:
						typeof order.toy === "object" && order.toy && "name" in order.toy
							? String(order.toy.name)
							: "Toy",
					quantity: Number(order.quantity ?? 0),
					plannedStart: schedule.plannedStart.toISOString(),
					plannedFinish: schedule.plannedFinish.toISOString(),
				},
			});
		});

		log.info("Production order scheduled", { orderId: input.orderId });
		return {
			status: "scheduled",
			plannedStart: schedule.plannedStart.toISOString(),
			plannedFinish: schedule.plannedFinish.toISOString(),
		};
	},
});
