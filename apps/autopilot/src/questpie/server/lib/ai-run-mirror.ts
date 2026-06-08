import type { AiRunStatus } from "@questpie/ai";
import type { GlobalCollectionHookContext } from "questpie";

import type { AppCollections } from "./app-types";
import type { CollectionDoc } from "#questpie";
import { asRecord, mergeRecords, relationId } from "./records";

type TerminalRunStatus = Extract<
	AiRunStatus,
	"completed" | "failed" | "cancelled"
>;

function terminalTaskStatus(status: TerminalRunStatus) {
	if (status === "completed") return "review";
	if (status === "cancelled") return "cancelled";
	return "failed";
}

function isTerminalStatus(status: unknown): status is TerminalRunStatus {
	return (
		status === "completed" || status === "failed" || status === "cancelled"
	);
}

function activeRunStatus(status: unknown) {
	return status === "pending" || status === "claimed" || status === "running";
}

function statusFrom(value: unknown) {
	return typeof value === "string" ? value : null;
}

function isChatRunStatus(value: string): value is ChatRunStatus {
	return (
		value === "pending" ||
		value === "claimed" ||
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	);
}

function dateOrUndefined(value: unknown) {
	if (!value) return undefined;
	return value instanceof Date ? value : new Date(String(value));
}

function setIfPresent(
	data: Record<string, unknown>,
	key: string,
	value: unknown,
) {
	if (value !== undefined && value !== null) data[key] = value;
}

async function sendWorkflowEvent(
	ctx: GlobalCollectionHookContext,
	event: string,
	runId: string,
	data: Record<string, unknown>,
) {
	if (!ctx.workflows?.sendEvent) return;
	await ctx.workflows.sendEvent(event, { runId, ...data }, { runId });
}

async function runLinkForAiRun(collections: AppCollections, aiRunId: string) {
	return collections.run_links.findOne({
		where: { aiRun: aiRunId },
	});
}

type ChatRunStatus =
	| "pending"
	| "claimed"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

async function mirrorChatRunStatus(
	collections: AppCollections,
	runId: string,
	status: ChatRunStatus,
) {
	const messages = await collections.chat_messages.find({
		where: { run: runId },
		limit: 100,
	});
	await Promise.all(
		messages.docs.map((message) =>
			collections.chat_messages.updateById({
				id: message.id,
				data: { runStatus: status },
			}),
		),
	);
}

async function createCompletionResources(input: {
	ctx: GlobalCollectionHookContext;
	runId: string;
	summary?: string | null;
}) {
	if (!input.summary?.trim()) return [];
	if (!input.ctx.services?.knowledgeResource) return [];

	const existing = await input.ctx.collections.assets.findOne({
		where: { run: input.runId, path: `runs/${input.runId}/summary.md` },
	});
	if (existing) return [existing];

	return input.ctx.services.knowledgeResource.createRunOutputs({
		runId: input.runId,
		summary: input.summary,
		source: "worker",
	});
}

async function mirrorTerminalSideEffects(input: {
	ctx: GlobalCollectionHookContext;
	runLink: CollectionDoc<"run_links">;
	status: TerminalRunStatus;
	summary?: string | null;
	error?: string | null;
}) {
	const resources = await createCompletionResources({
		ctx: input.ctx,
		runId: String(input.runLink.id),
		summary: input.summary,
	});
	const knowledgeResourceIds = resources.map(
		(resource: { id: string }) => resource.id,
	);

	const taskId = relationId(input.runLink.task);
	const initiatedBy = input.runLink.initiatedBy;
	// Chat runs can be linked to a task for context, but they are
	// conversational — only task/schedule runs drive the task's status.
	if (taskId && initiatedBy !== "chat") {
		await input.ctx.collections.tasks.updateById({
			id: taskId,
			data: { status: terminalTaskStatus(input.status) },
		});
	}

	await sendWorkflowEvent(
		input.ctx,
		"run.completed",
		String(input.runLink.id),
		{
			status: input.status,
			summary: input.summary ?? null,
			error: input.error ?? null,
			knowledgeResourceIds,
		},
	);
}

export async function mirrorAiRunChange(ctx: GlobalCollectionHookContext) {
	if (ctx.collection !== "ai_runs" || !ctx.data?.id) return;

	const aiRunId = String(ctx.data.id);
	const runLink = await runLinkForAiRun(ctx.collections, aiRunId);
	if (!runLink) return;

	const status = statusFrom(ctx.data.status);
	const originalStatus = statusFrom(ctx.original?.status);
	const data: Record<string, unknown> = {};
	setIfPresent(data, "status", status);
	setIfPresent(data, "summary", ctx.data.summary);
	setIfPresent(data, "error", ctx.data.error);
	setIfPresent(data, "tokensInput", ctx.data.tokensInput);
	setIfPresent(data, "tokensOutput", ctx.data.tokensOutput);
	setIfPresent(data, "cost", ctx.data.cost);
	setIfPresent(data, "startedAt", dateOrUndefined(ctx.data.startedAt));
	setIfPresent(data, "endedAt", dateOrUndefined(ctx.data.endedAt));
	setIfPresent(data, "runtimeSessionRef", ctx.data.runtimeSessionRef);
	if (status === "claimed") {
		data.metadata = mergeRecords(runLink.metadata, {
			workerId: relationId(ctx.data.worker),
		});
	}

	const updated =
		Object.keys(data).length > 0
			? await ctx.collections.run_links.updateById({
					id: String(runLink.id),
					data,
				})
			: runLink;

	if (status && isChatRunStatus(status)) {
		await mirrorChatRunStatus(ctx.collections, String(runLink.id), status);
	}

	if (status === "claimed" && originalStatus !== "claimed") {
		await sendWorkflowEvent(ctx, "run.claimed", String(runLink.id), {
			workerId: relationId(ctx.data.worker),
		});
	}

	if (isTerminalStatus(status) && originalStatus !== status) {
		await mirrorTerminalSideEffects({
			ctx,
			runLink: updated,
			status,
			summary: typeof ctx.data.summary === "string" ? ctx.data.summary : null,
			error: typeof ctx.data.error === "string" ? ctx.data.error : null,
		});
	}
}

export async function mirrorAiRunEvent(ctx: GlobalCollectionHookContext) {
	if (
		ctx.collection !== "ai_run_events" ||
		ctx.operation !== "create" ||
		!ctx.data
	) {
		return;
	}

	const aiRunId = relationId(ctx.data.run);
	if (!aiRunId) return;

	const runLink = await runLinkForAiRun(ctx.collections, aiRunId);
	if (!runLink) return;

	const eventType =
		typeof ctx.data.type === "string" ? ctx.data.type : "unknown";
	const level = typeof ctx.data.level === "string" ? ctx.data.level : "info";
	const summary =
		typeof ctx.data.summary === "string" ? ctx.data.summary : null;
	const metadata = asRecord(ctx.data.meta);

	if (eventType === "started" && activeRunStatus(runLink.status)) {
		await ctx.collections.run_links.updateById({
			id: String(runLink.id),
			data: {
				status: "running",
				startedAt: dateOrUndefined(runLink.startedAt) ?? new Date(),
			},
		});
		await mirrorChatRunStatus(ctx.collections, String(runLink.id), "running");
	}

	await sendWorkflowEvent(ctx, "run.event", String(runLink.id), {
		type: eventType,
		level,
		summary,
		metadata: Object.keys(metadata).length > 0 ? metadata : null,
	});
}

export async function mirrorRunLinkChatStatus(ctx: GlobalCollectionHookContext) {
	if (ctx.collection !== "run_links" || !ctx.data?.id) return;
	const status = statusFrom(ctx.data.status);
	if (!status) return;
	if (isChatRunStatus(status)) {
		await mirrorChatRunStatus(ctx.collections, String(ctx.data.id), status);
	}
}

export async function mirrorAiRunCollectionChange(
	ctx: GlobalCollectionHookContext,
) {
	await mirrorAiRunChange(ctx);
	await mirrorAiRunEvent(ctx);
	await mirrorRunLinkChatStatus(ctx);
}
