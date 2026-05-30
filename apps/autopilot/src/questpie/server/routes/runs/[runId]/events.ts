import { ApiError } from "questpie/errors";
import { route } from "questpie/services";

import { relationId } from "../../../lib/records";

function authorizeRequest(ctx: Questpie.AppContext & { request: Request }) {
	if (ctx.session?.user) return;
	if (ctx.request.headers.get("x-local-dev") === "true") return;
	throw ApiError.unauthorized("Authentication required");
}

function json(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

export default route()
	.get()
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => {
		authorizeRequest(ctx);
		const url = new URL(ctx.request.url);
		const limit = Number(url.searchParams.get("limit") ?? 100);
		const run = await ctx.collections.run_links.findOne({
			where: { id: ctx.params.runId },
		});
		if (!run) return json([]);

		const aiRunId = relationId(run.aiRun);
		if (!aiRunId) return json([]);

		const events = await ctx.collections.ai_run_events.find({
			where: { run: aiRunId },
			limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 100,
			orderBy: { createdAt: "asc" },
		});
		return json(
			events.docs.map((event: Record<string, unknown>) => ({
				...event,
				run: ctx.params.runId,
				aiRun: aiRunId,
				metadata: event.meta,
			})),
		);
	});
