import { route } from "questpie/services";
import { z } from "zod";

export default route()
	.post()
	.schema(
		z.object({
			orderId: z.string(),
		}),
	)
	.handler(async (ctx) => {
		const { input, workflows } = ctx;
		const result = await workflows.trigger(
			"production-order-plan",
			{ orderId: input.orderId },
			{ idempotencyKey: `production-order-plan:${input.orderId}` },
		);

		return result;
	});
