import { route } from "questpie/services";
import { z } from "zod";

import {
	authenticateLegacyWorker,
	snakeWorkerId,
	toLegacyClaimResponse,
} from "../../lib/legacy-worker-contract";
import { workflowsFromContext } from "../../lib/workflows";

const claimSchema = z.object({
	workerId: z.string().optional(),
	worker_id: z.string().optional(),
	runtime: z.enum(["claude-code", "codex", "opencode"]).optional(),
	capabilities: z
		.array(
			z.object({
				runtime: z.string().optional(),
				models: z.array(z.string()).optional(),
				tags: z.array(z.string()).optional(),
				maxConcurrent: z.number().int().positive().optional(),
			}),
		)
		.optional(),
	shared_checkout_locked: z.boolean().optional(),
	shared_checkout_enabled: z.boolean().optional(),
	worktree_isolation_available: z.boolean().optional(),
});

export default route()
	.post()
	.schema(claimSchema)
	.handler(async (ctx) => {
		const { worker } = await authenticateLegacyWorker(
			ctx,
			snakeWorkerId(ctx.input),
		);

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
			limit: 1,
		});
		const claim = claims[0] ?? null;

		if (claim && typeof claim.run.id === "string") {
			await workflowsFromContext(ctx).sendEvent(
				"run.claimed",
				{
					runId: claim.run.id,
					workerId: worker.id,
					leaseId: claim.leaseId,
					expiresAt: claim.expiresAt.toISOString(),
				},
				{ runId: claim.run.id },
			);
		}

		return toLegacyClaimResponse({
			leaseId: claim?.leaseId ?? null,
			payload: (claim?.payload as Record<string, unknown> | undefined) ?? null,
		});
	});
