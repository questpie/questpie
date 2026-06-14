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

import { sessionOnly } from "../../../lib/route-access";

export default route()
	.get()
	.access(sessionOnly)
	.raw()
	.handler(async ({ request, collections, kv, params }) => {
		const chatId = (params as any).chatId as string;
		if (!chatId) {
			return Response.json({ error: "chatId is required" }, { status: 400 });
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
