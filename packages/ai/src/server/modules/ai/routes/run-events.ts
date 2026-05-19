import { route } from "questpie";
import { z } from "zod";

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
		await authenticateWorker(ctx);
		const { aiWorkerManager } = getAiServices(ctx);
		await aiWorkerManager.reportRunEvent({
			runId: ctx.input.runId,
			event: ctx.input.event,
		});
		return { ok: true };
	});
