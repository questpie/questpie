import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import { mcpJson, requireMcpCaller } from "../lib/mcp-tool-helpers";
import { workflowsFromContext } from "../lib/workflows";

export const taskUpdate = mcpTool("task_update", {
	title: "Update task",
	description:
		"Update a task's fields (title, description, priority, status, type).",
	inputSchema: z.object({
		id: z.string().min(1).describe("Task id"),
		title: z.string().optional(),
		description: z.string().optional(),
		priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
		status: z
			.enum([
				"backlog",
				"pending",
				"running",
				"waiting",
				"review",
				"approved",
				"done",
				"failed",
				"cancelled",
			])
			.optional(),
		type: z
			.enum(["task", "feature", "bug", "research", "review", "approval"])
			.optional(),
	}),
	annotations: { destructiveHint: false, idempotentHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
	});
	if (!task) throw ApiError.notFound("Task", input.id);

	const { id: _, ...updates } = input;
	const updated = await ctx.collections.tasks.update({
		where: { id: input.id },
		data: updates,
	});
	return mcpJson(updated);
});

export const taskCancel = mcpTool("task_cancel", {
	title: "Cancel task",
	description: "Cancel a task and record cancellation activity.",
	inputSchema: z.object({
		id: z.string().min(1).describe("Task id"),
		reason: z.string().optional().describe("Cancellation reason"),
	}),
	annotations: { destructiveHint: true, idempotentHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	const caller = await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
	});
	if (!task) throw ApiError.notFound("Task", input.id);

	const terminal = ["done", "cancelled", "failed"];
	if (terminal.includes(task.status as string)) {
		throw ApiError.badRequest(
			`Task is already ${String(task.status)} and cannot be cancelled`,
		);
	}

	const updated = await ctx.collections.tasks.update({
		where: { id: input.id },
		data: { status: "cancelled" },
	});

	await ctx.collections.activity.create({
		actor: caller.actorId,
		type: "task.cancelled",
		summary: input.reason ?? `Task cancelled`,
		task: input.id,
		project: task.project as string | undefined,
		details: { source: "mcp", ...(input.reason && { reason: input.reason }) },
	});

	return mcpJson(updated);
});

export const taskRetry = mcpTool("task_retry", {
	title: "Retry task",
	description:
		"Reset a failed/cancelled task to pending and re-trigger its pipeline.",
	inputSchema: z.object({
		id: z.string().min(1).describe("Task id"),
	}),
	annotations: { destructiveHint: false, idempotentHint: false },
}).handler(async ({ input, ctx, request, accessMode }) => {
	const caller = await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
	});
	if (!task) throw ApiError.notFound("Task", input.id);

	const retriable = ["failed", "cancelled"];
	if (!retriable.includes(task.status as string)) {
		throw ApiError.badRequest(
			`Task is ${String(task.status)} - only failed or cancelled tasks can be retried`,
		);
	}

	const updated = await ctx.collections.tasks.update({
		where: { id: input.id },
		data: { status: "pending" },
	});

	await ctx.collections.activity.create({
		actor: caller.actorId,
		type: "task.retry",
		summary: `Task retried via MCP`,
		task: input.id,
		project: task.project as string | undefined,
		details: { source: "mcp" },
	});

	const workflow = await workflowsFromContext(ctx).trigger(
		"task-pipeline",
		{
			taskId: input.id,
			runReason: "retry",
			requestedBy: caller.actorId,
		},
		{ idempotencyKey: `task-pipeline:${input.id}` },
	);

	return mcpJson({
		task: updated,
		workflow_instance_id: workflow.instanceId,
		existing_workflow: workflow.existing,
	});
});
