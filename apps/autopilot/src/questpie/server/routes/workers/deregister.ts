import { route } from "questpie/services";
import { z } from "zod";

import {
	authenticateLegacyWorker,
	snakeWorkerId,
} from "../../lib/legacy-worker-contract";

const deregisterSchema = z.object({
	workerId: z.string().optional(),
	worker_id: z.string().optional(),
});

export default route()
	.post()
	.schema(deregisterSchema)
	.handler(async (ctx) => {
		const requestedWorkerId = snakeWorkerId(ctx.input);
		const { worker } = await authenticateLegacyWorker(ctx, requestedWorkerId);
		const workerId = String(worker.id);
		const existing = await ctx.collections.workers.findOne({
			where: { id: workerId },
		});
		if (!existing) {
			return {
				ok: true,
				worker_id: workerId,
				released_run_ids: [],
			};
		}

		const leases = await ctx.collections.worker_leases.find({
			where: { worker: workerId, status: "active" },
			limit: 1000,
		});
		const releasedRunIds: string[] = [];

		for (const lease of leases.docs) {
			await ctx.collections.worker_leases.updateById({
				id: lease.id,
				data: { status: "released" },
			});
			const runId =
				typeof lease.run === "string"
					? lease.run
					: lease.run && typeof lease.run === "object" && "id" in lease.run
						? String(lease.run.id)
						: null;
			if (!runId) continue;
			await ctx.collections.runs.update({
				where: { id: runId, status: { in: ["claimed", "running"] } },
				data: {
					status: "pending",
					worker: null as any,
					error: "worker deregistered",
				},
			});
			releasedRunIds.push(runId);
		}

		await ctx.collections.workers.updateById({
			id: workerId,
			data: { status: "offline" },
		});

		return {
			ok: true,
			worker_id: workerId,
			released_run_ids: releasedRunIds,
		};
	});
