import { route } from "questpie";
import { z } from "zod";

import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const pollSchema = z.object({
	workerId: z.string(),
	runtimes: z.array(z.string()).min(1),
	limit: z.number().int().positive().max(10).default(1),
});

export default route()
	.post()
	.schema(pollSchema)
	.handler(async (ctx) => {
		await authenticateWorker(ctx);
		const { workerManager } = getAiServices(ctx);
		const claimed = await workerManager.claimRun({
			workerId: ctx.input.workerId,
			runtimes: ctx.input.runtimes,
			limit: ctx.input.limit,
		});
		return { run: claimed };
	});
