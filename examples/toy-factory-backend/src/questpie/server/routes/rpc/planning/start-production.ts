import { route } from "questpie";
import { z } from "zod";

type WorkflowsApi = {
	trigger(
		name: "production-order-plan",
		input: { orderId: string },
		options?: { idempotencyKey?: string },
	): Promise<{ instanceId: string; existing: boolean }>;
};

export default route()
	.post()
	.schema(
		z.object({
			orderId: z.string(),
		}),
	)
	.handler(async (ctx) => {
		const { input } = ctx;
		const workflows = (ctx as typeof ctx & { workflows: WorkflowsApi })
			.workflows;
		const result = await workflows.trigger(
			"production-order-plan",
			{ orderId: input.orderId },
			{ idempotencyKey: `production-order-plan:${input.orderId}` },
		);

		return result;
	});
