/**
 * GET /api/runs/{runId}/stream — the sole SSE framer over a run's resumable-KV
 * token stream (canonical UIMessage chunks framed once at the edge). Inline
 * lease-liveness, contiguity-safe tail, `event: expired` on a TTL gap, close on
 * `:done` / terminal status. This is the `useChat({resume})` reconnect target.
 */

import { route } from "questpie/services";

import { sessionOnly } from "../../../lib/route-access";
import { createRunStreamResponse } from "../../../lib/run-stream";

export default route()
	.get()
	.access(sessionOnly)
	.raw()
	.handler(async (ctx) => {
		const runId = (ctx.params as { runId?: string }).runId;
		if (!runId) {
			return Response.json({ error: "runId is required" }, { status: 400 });
		}
		return createRunStreamResponse({
			request: ctx.request,
			collections: ctx.collections as never,
			kv: ctx.kv,
			services: ctx.services as never,
			workflows: (ctx as { workflows?: unknown }).workflows as never,
			runId,
		});
	});
