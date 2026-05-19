import { route } from "questpie/services";
import { z } from "zod";

import { mergeRecords } from "../lib/records";
import { authenticatedWorker } from "../lib/worker-auth";
import { workflowsFromContext } from "../lib/workflows";

const capabilitySchema = z.object({
	runtime: z.string().optional(),
	models: z.array(z.string()).optional(),
	tags: z.array(z.string()).optional(),
	maxConcurrent: z.number().int().positive().optional(),
});

const pollSchema = z.object({
	workerId: z.string().optional(),
	runtime: z.enum(["claude-code", "codex", "opencode"]).optional(),
	capabilities: z.array(capabilitySchema).optional(),
	limit: z.number().int().positive().max(10).default(1),
});

export default route()
	.post()
	.schema(pollSchema)
	.handler(async (ctx) => {
		const worker = await authenticatedWorker(ctx, ctx.input.workerId);

		await ctx.services.workerManager.expireStaleLeases();
		await ctx.services.workerManager.heartbeat({
			workerId: worker.id,
			status: "online",
			capabilities: ctx.input.capabilities ?? worker.capabilities,
		});

		const claims = await ctx.services.workerManager.claimRuns({
			workerId: worker.id,
			runtime: ctx.input.runtime,
			capabilities: ctx.input.capabilities,
			limit: ctx.input.limit,
		});

		for (const claim of claims) {
			const run = claim.run as { id?: unknown };
			if (typeof run.id !== "string") continue;
			const runLink = await ctx.collections.run_links.findOne({
				where: { id: run.id },
			});
			if (runLink) {
				await ctx.collections.run_links.updateById({
					id: run.id,
					data: {
						status: "claimed",
						startedAt: new Date(),
						metadata: mergeRecords(runLink.metadata, {
							workerId: worker.id,
							leaseId: claim.leaseId,
							expiresAt: claim.expiresAt.toISOString(),
						}) as any,
					},
				});
			}
			await workflowsFromContext(ctx).sendEvent(
				"run.claimed",
				{
					runId: run.id,
					workerId: worker.id,
					leaseId: claim.leaseId,
					expiresAt: claim.expiresAt.toISOString(),
				},
				{ runId: run.id },
			);
		}

		const first = claims[0] ?? null;

		return {
			claims: claims.map(
				(claim: { leaseId: string; expiresAt: Date; payload: unknown }) => ({
					leaseId: claim.leaseId,
					expiresAt: claim.expiresAt.toISOString(),
					run: claim.payload,
				}),
			),
			run: first?.payload ?? null,
			leaseId: first?.leaseId ?? null,
			lease_id: first?.leaseId ?? null,
		};
	});
