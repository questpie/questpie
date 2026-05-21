import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { authenticateWorker, getAiServices } from "../lib/service-context.js";

const heartbeatSchema = z.object({
	workerId: z.string(),
});

export default route()
	.post()
	.schema(heartbeatSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		await authenticateWorker(routeCtx);
		const { workerManager } = getAiServices(routeCtx);
		return workerManager.heartbeat(routeCtx.input.workerId);
	});
