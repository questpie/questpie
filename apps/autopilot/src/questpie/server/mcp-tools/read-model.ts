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
			workflowConfig: true,
			capability: true,
			model: true,
		},
	});
	if (!task) throw ApiError.notFound("Task", input.id);
	return mcpJson(task);
});

export const runList = mcpTool("run_list", {
	title: "List runs",
	description: "List runs with optional task, status, and worker filters.",
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
	if (input.worker_id) where.worker = input.worker_id;
	const result = await ctx.collections.runs.find({
		where,
		limit: input.limit ?? 50,
		orderBy: { updatedAt: "desc" },
		with: { task: true, project: true, worker: true, model: true },
	});
	return mcpJson(result.docs);
});

export const runGet = mcpTool("run_get", {
	title: "Get run",
	description: "Get a run by id.",
	inputSchema: z.object({ id: z.string().min(1) }),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const run = await ctx.collections.runs.findOne({
		where: { id: input.id },
		with: {
			task: true,
			project: true,
			worker: true,
			model: true,
			provider: true,
		},
	});
	if (!run) throw ApiError.notFound("Run", input.id);
	return mcpJson(run);
});

export const runEvents = mcpTool("run_events", {
	title: "List run events",
	description: "List events for a run.",
	inputSchema: z.object({
		id: z.string().min(1).describe("Run id"),
		limit: z.number().int().positive().max(500).optional(),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const result = await ctx.collections.run_events.find({
		where: { run: input.id },
		limit: input.limit ?? 100,
		orderBy: { createdAt: "asc" },
	});
	return mcpJson(result.docs);
});
