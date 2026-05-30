import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const eventSchema = z.object({
	runId: z.string(),
	event: z
		.object({
			type: z.string(),
			text: z.string().optional(),
			tool: z.string().optional(),
			commandId: z.string().optional(),
			level: z.enum(["debug", "info", "warn", "error"]).optional(),
			sequence: z.number().optional(),
		})
		.passthrough(),
});

export default route()
	.post()
	.schema(eventSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		await authenticateWorker(routeCtx);
		const { workerManager } = getAiServices(routeCtx);
		await workerManager.reportRunEvent({
			runId: routeCtx.input.runId,
			event: routeCtx.input.event,
		});
		return { ok: true };
	});
