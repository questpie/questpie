import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import {
	mcpJson,
	parseJsonObject,
	requireMcpCaller,
} from "../lib/mcp-tool-helpers";
import { workflowsFromContext } from "../lib/workflows";

const taskTypes = ["task", "feature", "bug", "research", "review", "approval"];
const priorities = ["low", "medium", "high", "urgent"];

function normalizeTaskType(value: string | undefined) {
	if (!value) return "task";
	return taskTypes.includes(value) ? value : "task";
}

function normalizePriority(value: string | undefined) {
	if (value === "critical") return "urgent";
	if (!value) return "medium";
	return priorities.includes(value) ? value : "medium";
}

const inputSchema = z.object({
	title: z.string().min(1).describe("Task title"),
	type: z.string().optional().describe("Task type"),
	description: z.string().optional().describe("Task description"),
	priority: z.string().optional().describe("Priority"),
	assigned_to: z.string().optional().describe("Capability or agent id"),
	project_id: z.string().optional().describe("Project id"),
	queue: z.string().optional().describe("Named execution queue"),
	start_after: z.string().optional().describe("ISO datetime"),
	depends_on: z.array(z.string()).optional().describe("Dependency task ids"),
	workflow_id: z.string().optional().describe("Workflow config id"),
	context: z.string().optional().describe("Task context JSON object"),
	metadata: z.string().optional().describe("Task metadata JSON object"),
	start: z.boolean().optional().describe("Whether to start the task pipeline"),
});

export default mcpTool("task_create", {
	title: "Create task",
	description: "Create an Autopilot task and optionally start its workflow.",
	inputSchema,
	annotations: { destructiveHint: false, idempotentHint: false },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const project = input.project_id
		? await ctx.collections.projects.findOne({
				where: { id: input.project_id },
			})
		: null;
	if (input.project_id && !project) {
		throw ApiError.notFound("Project", input.project_id);
	}

	const shouldStart = input.start ?? true;
	const task = await ctx.collections.tasks.create({
		title: input.title,
		description: input.description,
		type: normalizeTaskType(input.type),
		status: shouldStart ? "pending" : "backlog",
		priority: normalizePriority(input.priority),
		project: input.project_id,
		scopeType: input.project_id ? "project" : "company",
		workflowConfig: input.workflow_id,
		capability: input.assigned_to,
		queue: input.queue,
		startAfter: input.start_after ? new Date(input.start_after) : undefined,
		createdBy: ctx.session?.user?.id ?? "mcp",
		context: parseJsonObject(input.context) as any,
		metadata: parseJsonObject(input.metadata) as any,
	});

	for (const dependencyId of input.depends_on ?? []) {
		await ctx.collections.task_relations.create({
			sourceTask: task.id,
			targetTask: dependencyId,
			relationType: "depends_on",
			dedupeKey: `${task.id}:depends_on:${dependencyId}`,
			createdBy: ctx.session?.user?.id ?? "mcp",
		});
	}

	await ctx.collections.activity.create({
		actor: ctx.session?.user?.id ?? "mcp",
		type: "task.intake",
		summary: `Created task: ${task.title}`,
		task: task.id,
		project: input.project_id,
		details: {
			source: "mcp",
			start: shouldStart,
		},
	});

	const workflow = shouldStart
		? await workflowsFromContext(ctx).trigger(
				"task-pipeline",
				{
					taskId: task.id,
					runReason: "mcp",
					requestedBy: ctx.session?.user?.id ?? "mcp",
				},
				{ idempotencyKey: `task-pipeline:${task.id}` },
			)
		: null;

	return mcpJson({
		task_id: task.id,
		task,
		workflow_instance_id: workflow?.instanceId ?? null,
		existing_workflow: workflow?.existing ?? false,
	});
});
