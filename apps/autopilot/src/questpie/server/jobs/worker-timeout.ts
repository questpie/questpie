import { job } from "questpie/services";
import { z } from "zod";

import { relationId } from "../lib/records";
import { dateOrNull } from "../lib/schedules";

function cutoffDate(minutes: number) {
	return new Date(Date.now() - minutes * 60 * 1000);
}

export default job({
	name: "worker-timeout",
	schema: z.object({
		staleHeartbeatMinutes: z.number().int().positive().default(5),
		limit: z.number().int().positive().max(500).default(200),
	}),
	options: {
		cron: "*/5 * * * *",
		retryLimit: 1,
	},
	handler: async (ctx) => {
		const staleBefore = cutoffDate(ctx.payload.staleHeartbeatMinutes);
		const workers = await ctx.collections.workers.find({
			where: { status: { in: ["online", "busy", "draining"] } },
			limit: ctx.payload.limit,
			orderBy: { lastHeartbeat: "asc" },
		});
		const staleWorkerIds: string[] = [];

		for (const worker of workers.docs as Array<Record<string, unknown>>) {
			const heartbeat = dateOrNull(worker.lastHeartbeat);
			if (heartbeat && heartbeat > staleBefore) continue;

			await ctx.collections.workers.updateById({
				id: String(worker.id),
				data: { status: "offline" },
			});
			staleWorkerIds.push(String(worker.id));

			const leases = await ctx.collections.worker_leases.find({
				where: { worker: String(worker.id), status: "active" },
				limit: 100,
			});
			for (const lease of leases.docs) {
				const runId = relationId(lease.run);
				await ctx.collections.worker_leases.updateById({
					id: lease.id,
					data: { status: "expired" },
				});
				if (runId) {
					await ctx.collections.runs.update({
						where: { id: runId, status: { in: ["claimed", "running"] } },
						data: {
							status: "pending",
							worker: null as any,
							error: "worker heartbeat timed out",
						},
					});
				}
			}

			await ctx.collections.activity.create({
				actor: "job:worker-timeout",
				type: "worker.offline",
				summary: `Worker timed out: ${worker.name ?? worker.id}`,
				details: {
					workerId: worker.id,
					lastHeartbeat: heartbeat?.toISOString() ?? null,
					expiredLeaseIds: leases.docs.map((lease: { id: string }) => lease.id),
				},
			});
		}

		const leaseExpiry = await ctx.services.workerManager.expireStaleLeases();
		return {
			checkedWorkers: workers.docs.length,
			staleWorkerIds,
			expiredLeaseIds: leaseExpiry.expiredLeaseIds,
			requeuedRunIds: leaseExpiry.requeuedRunIds,
		};
	},
});
