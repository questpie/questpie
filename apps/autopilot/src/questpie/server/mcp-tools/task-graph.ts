import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import { mcpJson, requireMcpCaller } from "../lib/mcp-tool-helpers";

export const taskDependencies = mcpTool("task_dependencies", {
	title: "List task dependencies",
	description:
		"List tasks that a given task depends on (upstream blockers).",
	inputSchema: z.object({
		id: z.string().min(1).describe("Task id"),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
	});
	if (!task) throw ApiError.notFound("Task", input.id);

	const relations = await ctx.collections.task_relations.find({
		where: { sourceTask: input.id, relationType: "depends_on" },
		limit: 200,
	});

	const targetIds = relations.docs.map(
		(r: Record<string, unknown>) => r.targetTask as string,
	);
	if (targetIds.length === 0) return mcpJson([]);

	const tasks = await ctx.collections.tasks.find({
		where: { id: { in: targetIds } },
		limit: 200,
	});
	return mcpJson(tasks.docs);
});

export const taskDependents = mcpTool("task_dependents", {
	title: "List task dependents",
	description:
		"List tasks that depend on a given task (downstream tasks blocked by this one).",
	inputSchema: z.object({
		id: z.string().min(1).describe("Task id"),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const task = await ctx.collections.tasks.findOne({
		where: { id: input.id },
	});
	if (!task) throw ApiError.notFound("Task", input.id);

	const relations = await ctx.collections.task_relations.find({
		where: { targetTask: input.id, relationType: "depends_on" },
		limit: 200,
	});

	const sourceIds = relations.docs.map(
		(r: Record<string, unknown>) => r.sourceTask as string,
	);
	if (sourceIds.length === 0) return mcpJson([]);

	const tasks = await ctx.collections.tasks.find({
		where: { id: { in: sourceIds } },
		limit: 200,
	});
	return mcpJson(tasks.docs);
});
