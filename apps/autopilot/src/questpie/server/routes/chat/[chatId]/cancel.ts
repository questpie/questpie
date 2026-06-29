/**
 * POST /api/chat/{chatId}/cancel — cancel an in-flight chat turn.
 *
 * Marks the stream as finished in the KV store and clears activeStreamId.
 */

import { route } from "questpie/services";
import { z } from "zod";

import { createQuestpieResumableStreamStore } from "@questpie/ai/harness-core";

import { sessionOnly } from "../../../lib/route-access";

export default route()
	.post()
	.access(sessionOnly)
	.outputSchema(
		z.union([
			z.object({ error: z.string() }),
			z.object({ cancelled: z.boolean(), chatId: z.string() }),
		]),
	)
	.handler(async ({ collections, kv, params }) => {
		const chatId = (params as any).chatId as string;
		if (!chatId) {
			return { error: "chatId is required" };
		}

		const session = await collections.chat_sessions.findOne({
			where: { id: chatId },
		});
		if (!session) {
			return { error: "Chat session not found" };
		}

		const activeStreamId =
			typeof session.activeStreamId === "string"
				? session.activeStreamId.trim()
				: null;

		if (activeStreamId) {
			const streamStore = createQuestpieResumableStreamStore({ kv });
			try {
				await streamStore.finish(activeStreamId);
			} catch {
				// best effort
			}
		}

		// Clear active stream + update status
		await collections.chat_sessions.updateById({
			id: chatId,
			data: { activeStreamId: null as any },
		});

		// Update any pending messages for this session
		const pendingMessages = await collections.chat_messages.find({
			where: {
				chatSession: chatId,
				runStatus: { in: ["pending", "running"] },
			},
			limit: 10,
		});
		for (const msg of pendingMessages.docs) {
			await collections.chat_messages.updateById({
				id: msg.id,
				data: { runStatus: "cancelled" },
			});
		}

		return { cancelled: true, chatId };
	});
