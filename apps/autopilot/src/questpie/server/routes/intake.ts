import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import { sessionOnly } from "../lib/route-access";
import { workflowsFromContext } from "../lib/workflows";

const intakeSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	projectId: z.string().optional(),
	type: z
		.enum(["task", "feature", "bug", "research", "review", "approval"])
		.default("task"),
	priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
	modelId: z.string().optional(),
	queue: z.string().optional(),
	context: z.record(z.string(), z.unknown()).optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
	createdBy: z.string().optional(),
	start: z.boolean().default(true),
});

export default route()
	.post()
	.access(sessionOnly)
	.schema(intakeSchema)
	.handler(async (ctx) => {
		const { input, collections } = ctx;
		const project = input.projectId
			? await collections.projects.findOne({ where: { id: input.projectId } })
			: null;
		if (input.projectId && !project) {
			throw ApiError.notFound("Project", input.projectId);
		}

		const task = await collections.tasks.create({
			title: input.title,
			description: input.description,
			type: input.type,
			status: input.start ? "pending" : "backlog",
			priority: input.priority,
			project: input.projectId,
			scopeType: input.projectId ? "project" : "company",
			model: input.modelId,
			queue: input.queue,
			createdBy: input.createdBy ?? ctx.session?.user?.id ?? "system",
			context: input.context,
			metadata: input.metadata,
		});

		await collections.activity.create({
			actor: input.createdBy ?? ctx.session?.user?.id ?? "system",
			type: "task.intake",
			summary: `Created task: ${task.title}`,
			task: task.id,
			project: input.projectId,
			details: {
				source: "intake",
				start: input.start,
			},
		});

		const workflow = input.start
			? await workflowsFromContext(ctx).trigger(
					"task-pipeline",
					{
						taskId: task.id,
						runReason: "intake",
						requestedBy: input.createdBy ?? ctx.session?.user?.id ?? "system",
					},
					{ idempotencyKey: `task-pipeline:${task.id}` },
				)
			: null;

		return {
			taskId: task.id,
			workflowInstanceId: workflow?.instanceId ?? null,
			existingWorkflow: workflow?.existing ?? false,
		};
	});
