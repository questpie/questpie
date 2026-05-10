import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import {
	authenticateLegacyWorker,
	snakeDeviceId,
	snakeWorkerId,
} from "../../lib/legacy-worker-contract";

const registerSchema = z.object({
	id: z.string().optional(),
	workerId: z.string().optional(),
	worker_id: z.string().optional(),
	deviceId: z.string().optional(),
	device_id: z.string().optional(),
	name: z.string().optional(),
	capabilities: z.unknown().optional(),
});

export default route()
	.post()
	.schema(registerSchema)
	.handler(async (ctx) => {
		const requestedWorkerId =
			ctx.input.id ?? snakeWorkerId(ctx.input) ?? undefined;
		const auth = await authenticateLegacyWorker(ctx, requestedWorkerId);
		const workerId = String(auth.worker.id);
		const deviceId = snakeDeviceId(ctx.input);

		let worker = await ctx.collections.workers.findOne({
			where: { id: workerId },
		});

		if (!worker && auth.localDev) {
			if (!deviceId) throw ApiError.badRequest("device_id is required");
			worker = await ctx.collections.workers.create({
				id: workerId as any,
				deviceId,
				name: ctx.input.name ?? workerId,
				status: "online",
				capabilities: ctx.input.capabilities ?? [],
				lastHeartbeat: new Date(),
				machineSecretHash: `local-dev:${workerId}`,
			} as any);
		}

		if (!worker) throw ApiError.notFound("Worker", workerId);

		const updated = await ctx.collections.workers.updateById({
			id: workerId,
			data: {
				deviceId: deviceId ?? worker.deviceId,
				name: ctx.input.name ?? worker.name,
				status: "online",
				capabilities: ctx.input.capabilities ?? worker.capabilities,
				lastHeartbeat: new Date(),
			},
		});

		return {
			workerId: updated.id,
			status: updated.status,
		};
	});
