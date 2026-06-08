import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { artifactContentResponse } from "../../../../../lib/legacy-run-artifacts";
import { sessionOnly } from "../../../../../lib/route-access";

export default route()
	.get()
	.access(sessionOnly)
	.params<{ runId: string; artifactId: string }>()
	.raw()
	.handler(async (ctx) => {
		const resource = await ctx.collections.assets.findOne({
			where: {
				id: ctx.params.artifactId,
				run: ctx.params.runId,
			},
		});
		if (!resource) throw ApiError.notFound("Artifact", ctx.params.artifactId);

		return artifactContentResponse(resource);
	});
