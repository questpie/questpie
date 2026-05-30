import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const completeSchema = z.object({
	runId: z.string(),
	workerId: z.string(),
	result: z.object({
		text: z.string().optional(),
		sessionRef: z.string().optional(),
		inputTokens: z.number().optional(),
		outputTokens: z.number().optional(),
		cost: z.number().optional(),
		stopReason: z.string().optional(),
	}),
});

export default route()
	.post()
	.schema(completeSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		await authenticateWorker(routeCtx);
		const { workerManager } = getAiServices(routeCtx);
		await workerManager.completeRun({
			runId: routeCtx.input.runId,
			workerId: routeCtx.input.workerId,
			result: routeCtx.input.result,
		});
		return { ok: true };
	});
