/**
 * GET /api/chat/{chatId}/stream — resume/stream the chat's active run.
 *
 * Resolves the session's `activeRun` and reuses the generic run-stream tail
 * (the sole SSE framer + inline liveness). `Last-Event-ID` / `?offset=N`
 * mid-stream resume is handled inside the tail.
 *
 * Returns 204 when no active run (idle).
 */

import { route } from "questpie/services";

import { relationId } from "../../../lib/records";
import { sessionOnly } from "../../../lib/route-access";
import { createRunStreamResponse } from "../../../lib/run-stream";

export default route()
	.get()
	.access(sessionOnly)
	.raw()
	.handler(async (ctx) => {
		const { request, collections, kv } = ctx;
		const chatId = (ctx.params as { chatId?: string }).chatId;
		if (!chatId) {
			return Response.json({ error: "chatId is required" }, { status: 400 });
		}

		const session = await collections.chat_sessions.findOne({
			where: { id: chatId },
		});
		const runId = relationId(session?.activeRun);
		if (!runId) return new Response(null, { status: 204 });
		return createRunStreamResponse({
			request,
			collections: collections as never,
			kv,
			services: ctx.services as never,
			workflows: (ctx as { workflows?: unknown }).workflows as never,
			runId,
		});
	});
