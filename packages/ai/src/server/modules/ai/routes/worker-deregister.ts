import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const deregisterSchema = z.object({
	workerId: z.string(),
});

export default route()
	.post()
	.schema(deregisterSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		await authenticateWorker(routeCtx);
		const { workerManager } = getAiServices(routeCtx);
		await workerManager.deregister(routeCtx.input.workerId);
		return { ok: true };
	});
