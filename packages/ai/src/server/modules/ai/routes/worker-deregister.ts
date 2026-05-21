import { route } from "questpie";
import { z } from "zod";

import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const deregisterSchema = z.object({
	workerId: z.string(),
});

export default route()
	.post()
	.schema(deregisterSchema)
	.handler(async (ctx) => {
		await authenticateWorker(ctx);
		const { workerManager } = getAiServices(ctx);
		await workerManager.deregister(ctx.input.workerId);
		return { ok: true };
	});
