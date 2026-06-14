/**
 * POST /api/chat/{chatId}/approve — HITL tool approval for an in-flight chat turn.
 *
 * Placeholder: the full HITL approval flow requires the harness agent to
 * expose a tool-approval channel. For now this accepts the approval payload
 * and stores it in session metadata for the producer to pick up.
 */

import { route } from "questpie/services";
import { z } from "zod";

import { sessionOnly } from "../../../lib/route-access";

const approveSchema = z.object({
	toolCallId: z.string(),
	approved: z.boolean(),
	response: z.unknown().optional(),
});

export default route()
	.post()
	.access(sessionOnly)
	.schema(approveSchema)
	.handler(async ({ input, collections, params }) => {
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

		// Store the approval response in session metadata for the producer
		const existingMeta =
			typeof session.metadata === "object" && session.metadata !== null
				? (session.metadata as Record<string, unknown>)
				: {};
		const approvals = Array.isArray(existingMeta.pendingApprovals)
			? (existingMeta.pendingApprovals as unknown[])
			: [];
		approvals.push({
			toolCallId: input.toolCallId,
			approved: input.approved,
			response: input.response,
			at: new Date().toISOString(),
		});

		await collections.chat_sessions.updateById({
			id: chatId,
			data: {
				metadata: { ...existingMeta, pendingApprovals: approvals },
			},
		});

		return { ok: true, toolCallId: input.toolCallId };
	});
