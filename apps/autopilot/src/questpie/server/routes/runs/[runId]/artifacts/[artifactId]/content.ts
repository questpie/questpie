import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { artifactContentResponse } from "../../../../../lib/legacy-run-artifacts";
import { authorizeWorkerOrSession } from "../../../../../lib/worker-auth";

export default route()
	.get()
	.params<{ runId: string; artifactId: string }>()
	.raw()
	.handler(async (ctx) => {
		await authorizeWorkerOrSession(ctx);
		const resource = await ctx.collections.knowledge.findOne({
			where: {
				id: ctx.params.artifactId,
				run: ctx.params.runId,
			},
		});
		if (!resource) throw ApiError.notFound("Artifact", ctx.params.artifactId);

		return artifactContentResponse(resource);
	});
