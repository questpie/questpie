import { route } from "questpie";
import { z } from "zod";

import { asAiJsonRoute } from "../lib/handler-context.js";
import { authenticateWorker, getAiServices } from "../lib/service-context.js";

// HTTP fleet surface (intentionally parked, not removed): a remote worker can
// claim run_links rows over HTTP, but finalize-over-HTTP (the remote
// counterpart of the in-process finalizeRun) is a follow-up.

const pollSchema = z.object({
	workerId: z.string(),
	runtimes: z.array(z.string()).min(1),
	limit: z.number().int().positive().max(10).default(1),
});

export default route()
	.post()
	.schema(pollSchema)
	.handler(async (ctx) => {
		const routeCtx = asAiJsonRoute(ctx);
		await authenticateWorker(routeCtx);
		const { workerManager } = getAiServices(routeCtx);
		const claimed = await workerManager.claimRun({
			workerId: routeCtx.input.workerId,
			runtimes: routeCtx.input.runtimes,
			limit: routeCtx.input.limit,
		});
		return { run: claimed };
	});
