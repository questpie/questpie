/**
 * POST /api/chat/{chatId}/cancel — cancel an in-flight chat turn.
 *
 * Resolves the session's `activeRun` and marks that run_links row cancelled;
 * the stream tail closes on the terminal status and the worker's cancel-poll
 * aborts the harness.
 */

import { route } from "questpie/services";
import { z } from "zod";

import { createQuestpieResumableStreamStore } from "@questpie/ai/harness-core";

import { activeRunStatus } from "../../../lib/legacy-run-artifacts";
import { relationId } from "../../../lib/records";
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

		// The run_links row is the execution record, so cancel resolves
		// chat_sessions.activeRun and marks that row cancelled. The stream tail
		// closes on the terminal status, the worker's 2s cancel-poll aborts the
		// harness, and finalizeRun's latch (status NOT IN terminal) refuses to
		// write the assistant message → no resurrection (§4.4).
		const activeRunId = relationId(session.activeRun);
		if (activeRunId) {
			const run = await collections.run_links.findOne({
				where: { id: activeRunId },
			});
			if (run && activeRunStatus(run.status)) {
				await collections.run_links.updateById({
					id: activeRunId,
					data: { status: "cancelled", endedAt: new Date() },
				});
				// A cancelled run never writes an assistant row (finalizeRun's
				// latch refuses terminal rows — the §4.4 resurrection guard), so
				// the durable cancelled marker lives on the turn's USER message.
				const chatMessageId = relationId(run.chatMessage);
				if (chatMessageId) {
					try {
						await collections.chat_messages.updateById({
							id: chatMessageId,
							data: { runStatus: "cancelled" },
						});
					} catch {
						// best effort — the run row stays the source of truth
					}
				}
				const runStreamId =
					typeof run.activeStreamId === "string"
						? run.activeStreamId.trim()
						: "";
				if (runStreamId && kv) {
					try {
						await createQuestpieResumableStreamStore({ kv }).finish(
							runStreamId,
						);
					} catch {
						// best effort — the tail also closes on the terminal status
					}
				}
			}
		}
		return { cancelled: true, chatId };
	});
