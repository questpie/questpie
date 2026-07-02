import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import { mcpJson, requireMcpCaller } from "../lib/mcp-tool-helpers";

export const taskList = mcpTool("task_list", {
	title: "List tasks",
	description: "List tasks with optional status and project filters.",
	inputSchema: z.object({
		status: z.string().optional(),
		project_id: z.string().optional(),
		limit: z.number().int().positive().max(100).optional(),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const where: Record<string, unknown> = {};
	if (input.status) where.status = input.status;
	if (input.project_id) where.project = input.project_id;
	const result = await ctx.collections.tasks.find({
		where,
		limit: input.limit ?? 50,
		orderBy: { updatedAt: "desc" },
	});
	return mcpJson(result.docs);
});

export const taskGet = mcpTool("task_get", {
	title: "Get task",
	description: "Get a task by id.",
	inputSchema: z.object({ id: z.string().min(1) }),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
		with: {
			project: true,
			model: true,
		},
	});
	if (!task) throw ApiError.notFound("Task", input.id);
	return mcpJson(task);
});

export const runList = mcpTool("run_list", {
	title: "List runs",
	description: "List product run links with optional task and status filters.",
	inputSchema: z.object({
		task_id: z.string().optional(),
		status: z.string().optional(),
		worker_id: z.string().optional(),
		limit: z.number().int().positive().max(100).optional(),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const where: Record<string, unknown> = {};
	if (input.task_id) where.task = input.task_id;
	if (input.status) where.status = input.status;
	const result = await ctx.collections.run_links.find({
		where,
		limit: input.limit ?? 50,
		orderBy: { updatedAt: "desc" },
		with: { task: true, project: true, provider: true, model: true },
	});
	return mcpJson(
		input.worker_id
			? result.docs.filter((run: Record<string, unknown>) => {
					const metadata = run.metadata as Record<string, unknown> | null;
					return metadata?.workerId === input.worker_id;
				})
			: result.docs,
	);
});

export const runGet = mcpTool("run_get", {
	title: "Get run",
	description: "Get a run by id.",
	inputSchema: z.object({ id: z.string().min(1) }),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const run = await ctx.collections.run_links.findOne({
		where: { id: input.id },
		with: {
			task: true,
			project: true,
			model: true,
			provider: true,
		},
	});
	if (!run) throw ApiError.notFound("Run", input.id);
	return mcpJson(run);
});

const EVENT_PREVIEW_MAX_LENGTH = 200;

function eventPreview(part: Record<string, unknown>): string {
	const text = typeof part.text === "string" ? part.text : null;
	const preview = text ?? JSON.stringify(part) ?? "";
	return preview.length > EVENT_PREVIEW_MAX_LENGTH
		? `${preview.slice(0, EVENT_PREVIEW_MAX_LENGTH)}…`
		: preview;
}

/** Persisted uiMessages tolerate both UIMessage[] and a single object. */
function persistedUiMessages(run: Record<string, unknown>): unknown[] {
	const stored = run.uiMessages;
	if (Array.isArray(stored)) return stored;
	if (
		stored &&
		typeof stored === "object" &&
		Array.isArray((stored as Record<string, unknown>).parts)
	) {
		return [stored];
	}
	return [];
}

export const runEvents = mcpTool("run_events", {
	title: "List run events",
	description:
		"List events for a run, derived from its persisted transcript (one event per message part).",
	inputSchema: z.object({
		id: z.string().min(1).describe("Run id"),
		limit: z.number().int().positive().max(500).optional(),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const run = await ctx.collections.run_links.findOne({
		where: { id: input.id },
	});
	if (!run) throw ApiError.notFound("Run", input.id);

	// Events are derived from the run_links row's persisted uiMessages
	// transcript — the legacy ai_run_events relay is gone.
	const events: Array<{ type: string; preview: string }> = [];
	for (const message of persistedUiMessages(run as Record<string, unknown>)) {
		const parts =
			message && typeof message === "object"
				? (message as Record<string, unknown>).parts
				: null;
		if (!Array.isArray(parts)) continue;
		for (const part of parts) {
			if (!part || typeof part !== "object") continue;
			const record = part as Record<string, unknown>;
			events.push({
				type: typeof record.type === "string" ? record.type : "unknown",
				preview: eventPreview(record),
			});
		}
	}
	return mcpJson(events.slice(0, input.limit ?? 100));
});
