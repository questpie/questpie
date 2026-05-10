import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { toLegacyRunStatus } from "../../lib/legacy-worker-contract";
import { authorizeWorkerOrSession } from "../../lib/worker-auth";

export default route()
	.get()
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => {
		await authorizeWorkerOrSession(ctx);

		const run = await ctx.collections.runs.findOne({
			where: { id: ctx.params.runId },
		});
		if (!run) throw ApiError.notFound("Run", ctx.params.runId);

		return Response.json(toLegacyRunStatus(run as Record<string, unknown>));
	});
