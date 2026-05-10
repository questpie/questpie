import { route } from "questpie/services";
import { z } from "zod";

import { authenticatedWorker } from "../lib/worker-auth";

const heartbeatSchema = z.object({
	workerId: z.string().optional(),
	status: z.enum(["online", "busy", "draining"]).optional(),
	capabilities: z.unknown().optional(),
});

export default route()
	.post()
	.schema(heartbeatSchema)
	.handler(async (ctx) => {
		const worker = await authenticatedWorker(ctx, ctx.input.workerId);
		const expired = await ctx.services.workerManager.expireStaleLeases();
		const heartbeat = await ctx.services.workerManager.heartbeat({
			workerId: worker.id,
			status: ctx.input.status,
			capabilities: ctx.input.capabilities ?? worker.capabilities,
		});

		return { ok: true, workerId: worker.id, heartbeat, expired };
	});
