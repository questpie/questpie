import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { getAiServices } from "../lib/service-context.js";
import { generateSecret } from "../services/worker-manager.js";

const enrollSchema = z.object({
	token: z.string(),
	name: z.string(),
	deviceId: z.string(),
	volumeId: z.string(),
	capabilities: z.unknown().default({}),
});

export default route()
	.post()
	.schema(enrollSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		const { workerManager } = getAiServices(routeCtx);
		const secret = generateSecret();
		const result = await workerManager.registerWorker({
			deviceId: routeCtx.input.deviceId,
			name: routeCtx.input.name,
			volumeId: routeCtx.input.volumeId,
			capabilities: routeCtx.input.capabilities,
			secret,
		});
		return { workerId: result.workerId, secret };
	});
