import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { getAiServices } from "../lib/service-context.js";

const registerSchema = z.object({
	deviceId: z.string(),
	name: z.string(),
	volumeId: z.string(),
	capabilities: z.unknown().default({}),
	secret: z.string(),
});

export default route()
	.post()
	.schema(registerSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		const { workerManager } = getAiServices(routeCtx);
		return workerManager.registerWorker(routeCtx.input);
	});
