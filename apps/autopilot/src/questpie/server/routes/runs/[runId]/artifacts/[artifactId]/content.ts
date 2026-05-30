import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { artifactContentResponse } from "../../../../../lib/legacy-run-artifacts";

function authorizeRequest(ctx: Questpie.AppContext & { request: Request }) {
	if (ctx.session?.user) return;
	if (ctx.request.headers.get("x-local-dev") === "true") return;
	throw ApiError.unauthorized("Authentication required");
}

export default route()
	.get()
	.params<{ runId: string; artifactId: string }>()
	.raw()
	.handler(async (ctx) => {
		authorizeRequest(ctx);
		const resource = await ctx.collections.knowledge.findOne({
			where: {
				id: ctx.params.artifactId,
				run: ctx.params.runId,
			},
		});
		if (!resource) throw ApiError.notFound("Artifact", ctx.params.artifactId);

		return artifactContentResponse(resource);
	});
