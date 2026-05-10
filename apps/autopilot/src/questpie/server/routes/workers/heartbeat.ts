import { route } from "questpie/services";
import { z } from "zod";

import {
	authenticateLegacyWorker,
	snakeWorkerId,
} from "../../lib/legacy-worker-contract";

const heartbeatSchema = z.object({
	workerId: z.string().optional(),
	worker_id: z.string().optional(),
	status: z.enum(["online", "busy", "draining"]).optional(),
	capabilities: z.unknown().optional(),
});

export default route()
	.post()
	.schema(heartbeatSchema)
	.handler(async (ctx) => {
		const { worker } = await authenticateLegacyWorker(
			ctx,
			snakeWorkerId(ctx.input),
		);
		const expired = await ctx.services.workerManager.expireStaleLeases();
		const heartbeat = await ctx.services.workerManager.heartbeat({
			workerId: worker.id,
			status: ctx.input.status,
			capabilities: ctx.input.capabilities ?? worker.capabilities,
		});

		return {
			ok: true,
			worker_id: worker.id,
			active_leases: heartbeat.activeLeases,
			status: heartbeat.status,
			expired_lease_ids: expired.expiredLeaseIds,
			requeued_run_ids: expired.requeuedRunIds,
		};
	});
