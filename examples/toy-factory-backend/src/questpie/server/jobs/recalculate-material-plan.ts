import { job } from "questpie/services";
import { z } from "zod";

type MaterialRequirement = {
	quantityPerUnit?: number;
	wastePercent?: number;
	material?: {
		name?: string;
		onHand?: number;
	};
};

export default job({
	name: "recalculate-material-plan",
	schema: z.object({
		orderId: z.string().optional(),
	}),
	handler: async ({ payload, collections }) => {
		const orders = payload.orderId
			? {
					docs: await Promise.all([
						collections.productionOrders.findOne({
							where: { id: payload.orderId },
						}),
					]),
				}
			: await collections.productionOrders.find({
					where: {
						status: { in: ["draft", "planning", "waiting-materials"] },
					},
					limit: 100,
				});

		const results = [];
		for (const order of orders.docs.filter(Boolean)) {
			const requirements = await collections.toyMaterials.find({
				where: { toy: order.toy },
				with: { material: true },
				limit: 100,
			});

			const shortages = (requirements.docs as MaterialRequirement[])
				.map((row) => {
					const required =
						Number(order.quantity ?? 0) *
						Number(row.quantityPerUnit ?? 0) *
						(1 + Number(row.wastePercent ?? 0) / 100);
					const onHand = Number(row.material?.onHand ?? 0);
					return {
						material: row.material?.name ?? "Unknown material",
						required,
						onHand,
						shortage: Math.max(0, required - onHand),
					};
				})
				.filter((row) => row.shortage > 0);

			await collections.productionOrders.update({
				where: { id: order.id },
				data: {
					materialStatus: shortages.length > 0 ? "shortage" : "available",
					status: shortages.length > 0 ? "waiting-materials" : "planning",
				},
			});

			results.push({ orderId: order.id, shortages });
		}

		return { checked: results.length, results };
	},
});
