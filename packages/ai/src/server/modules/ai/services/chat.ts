import type { ModelMessage } from "ai";
import { service } from "questpie";

export interface SendMessageInput {
	sessionId?: string | null;
	content: string;
	model?: string | null;
	provider?: string | null;
	attachments?: unknown[];
	scope?: { projectId?: string };
}

export interface CreateAssistantMessageInput {
	sessionId: string;
	runId: string;
	content: ModelMessage["content"];
	parts?: unknown[];
	model?: string;
	provider?: string;
}

export interface SendMessageResult {
	sessionId: string;
	messageId: string;
	runId: string;
}

export default service()
	.lifecycle("singleton")
	.create((ctx) => {
		const collections = ctx.collections as any;

		return {
			async createSession(input: {
				title?: string;
				scope?: { projectId?: string };
			}) {
				const session = await collections.ai_sessions.create({
					title: input.title ?? undefined,
					status: "active",
					scopeType: input.scope?.projectId ? "project" : "global",
					projectId: input.scope?.projectId ?? undefined,
				});
				return session;
			},

			async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
				let sessionId = input.sessionId;

				if (!sessionId) {
					const session = await collections.ai_sessions.create({
						status: "active",
						scopeType: input.scope?.projectId ? "project" : "global",
						projectId: input.scope?.projectId ?? undefined,
					});
					sessionId = session.id;
				}

				const message = await collections.ai_messages.create({
					session: sessionId,
					role: "user",
					content: input.content,
					attachments: input.attachments ?? undefined,
				});

				const run = await collections.ai_runs.create({
					status: "pending",
					runtime: "claude-code",
					prompt: input.content,
				});

				return {
					sessionId: sessionId!,
					messageId: message.id,
					runId: run.id,
				};
			},

			async listSessions(input: {
				status?: string;
				limit?: number;
				offset?: number;
			}) {
				const where: Record<string, unknown> = {};
				if (input.status) where.status = input.status;
				const result = await collections.ai_sessions.find({
					where,
					limit: input.limit ?? 50,
					offset: input.offset ?? 0,
					orderBy: { updatedAt: "desc" },
				});
				return result.docs;
			},

			async getSession(sessionId: string) {
				return collections.ai_sessions.findOne({ where: { id: sessionId } });
			},

			async closeSession(sessionId: string) {
				await collections.ai_sessions.updateById({
					id: sessionId,
					data: { status: "closed" },
				});
			},

			async createAssistantMessage(input: CreateAssistantMessageInput) {
				const message = await collections.ai_messages.create({
					session: input.sessionId,
					role: "assistant",
					content: input.content,
					parts: input.parts ?? undefined,
					run: input.runId,
					model: input.model ?? undefined,
					provider: input.provider ?? undefined,
				});
				return message;
			},

			async getMessages(sessionId: string, limit = 100) {
				const result = await collections.ai_messages.find({
					where: { session: sessionId },
					limit,
					orderBy: { createdAt: "asc" },
				});
				return result.docs;
			},
		};
	});
