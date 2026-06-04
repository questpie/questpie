import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { relationId } from "../../lib/records";
import { sessionOnly } from "../../lib/route-access";

function runStatus(input: Record<string, unknown>) {
	const metadata =
		typeof input.metadata === "object" && input.metadata
			? (input.metadata as Record<string, unknown>)
			: {};
	return {
		...input,
		task_id: relationId(input.task),
		project_id: relationId(input.project),
		worker_id: metadata.workerId ?? null,
	};
}

export default route()
	.get()
	.access(sessionOnly)
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => {
		const run = await ctx.collections.run_links.findOne({
			where: { id: ctx.params.runId },
		});
		if (!run) throw ApiError.notFound("Run", ctx.params.runId);

		return Response.json(runStatus(run as Record<string, unknown>));
	});
