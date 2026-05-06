import { route } from "questpie";
import { z } from "zod";

type WorkflowsApi = {
	sendEvent(
		event: "production.materials-ready",
		data: { materialId: string; quantity: number },
		match: { orderId: string },
	): Promise<void>;
};

export default route()
	.post()
	.schema(
		z.object({
			materialId: z.string(),
			quantity: z.number().positive(),
			orderId: z.string().optional(),
			reason: z.string().optional(),
		}),
	)
	.handler(async (ctx) => {
		const { input, collections } = ctx;
		const workflows = (ctx as typeof ctx & { workflows: WorkflowsApi })
			.workflows;
		const material = await collections.materials.findOne(
			{
				where: { id: input.materialId },
			},
			{ accessMode: "system" },
		);
		if (!material) {
			throw new Error(`Material not found: ${input.materialId}`);
		}

		const nextOnHand = Number(material.onHand ?? 0) + input.quantity;
		await collections.materials.update(
			{
				where: { id: input.materialId },
				data: { onHand: nextOnHand },
			},
			{ accessMode: "system" },
		);

		const movement = await collections.inventoryMovements.create(
			{
				material: input.materialId,
				productionOrder: input.orderId,
				direction: "receipt",
				quantity: input.quantity,
				reason: input.reason ?? "Material receipt",
				occurredAt: new Date(),
			},
			{ accessMode: "system" },
		);

		if (input.orderId) {
			await workflows.sendEvent(
				"production.materials-ready",
				{ materialId: input.materialId, quantity: input.quantity },
				{ orderId: input.orderId },
			);
		}

		return { movementId: movement.id, onHand: nextOnHand };
	});
