/**
 * GET /api/chat/{chatId}/stream — resume/stream the resumable SSE sink.
 *
 * If the chat session has an `activeStreamId`, opens the KV-backed resumable
 * stream and pipes SSE chunks to the client. Supports `Last-Event-ID` /
 * `?offset=N` for mid-stream resume.
 *
 * Returns 204 when no active stream (idle).
 */

import { route } from "questpie/services";

import {
	ResumableUIMessageStore,
	createQuestpieResumableStreamStore,
} from "@questpie/ai/harness-core";

import { isSingleModel } from "../../../lib/flags";
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

		// Consolidated model (AUTOPILOT_SINGLE_MODEL on): resolve the session's
		// active run and reuse the generic run-stream tail (the sole SSE framer +
		// inline liveness). Flag OFF keeps the legacy activeStreamId path below.
		if (isSingleModel()) {
			const activeSession = await collections.chat_sessions.findOne({
				where: { id: chatId },
			});
			const runId = relationId(activeSession?.activeRun);
			if (!runId) return new Response(null, { status: 204 });
			return createRunStreamResponse({
				request,
				collections: collections as never,
				kv,
				services: ctx.services as never,
				workflows: (ctx as { workflows?: unknown }).workflows as never,
				runId,
			});
		}

		const session = await collections.chat_sessions.findOne({
			where: { id: chatId },
		});
		if (!session) {
			return Response.json(
				{ error: "Chat session not found" },
				{ status: 404 },
			);
		}

		const activeStreamId =
			typeof session.activeStreamId === "string"
				? session.activeStreamId.trim()
				: null;

		if (!activeStreamId) {
			return new Response(null, { status: 204 });
		}

		// ── Resolve offset from Last-Event-ID or query param ────
		const url = new URL(request.url);
		const lastEventId = request.headers.get("Last-Event-ID");
		const offsetParam = url.searchParams.get("offset");
		const fromOffset = lastEventId
			? Number.parseInt(lastEventId, 10) || 0
			: offsetParam
				? Number.parseInt(offsetParam, 10) || 0
				: 0;

		// ── Open the resumable stream ───────────────────────────
		const streamStore = createQuestpieResumableStreamStore({ kv });
		const resumableStore = new ResumableUIMessageStore(streamStore);
		const sseStream = await resumableStore.resumeStream(
			activeStreamId,
			fromOffset,
		);

		if (!sseStream) {
			// Stream already completed and drained
			return new Response(null, { status: 204 });
		}

		// ── Pipe to client as SSE ───────────────────────────────
		let chunkIndex = fromOffset;
		const encoder = new TextEncoder();

		const outputStream = sseStream.pipeThrough(
			new TransformStream<string, Uint8Array>({
				transform(chunk, controller) {
					// Each chunk is already an SSE-formatted string from toUIMessageStream
					const eventId = String(chunkIndex++);
					controller.enqueue(
						encoder.encode(`id: ${eventId}\ndata: ${chunk}\n\n`),
					);
				},
			}),
		);

		request.signal.addEventListener("abort", () => {
			try {
				sseStream.cancel();
			} catch {
				// best effort
			}
		});

		return new Response(outputStream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});
