import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import { mcpJson, requireMcpCaller } from "../lib/mcp-tool-helpers";

export const scheduleList = mcpTool("schedule_list", {
	title: "List schedules",
	description: "List schedules with optional mode and enabled filters.",
	inputSchema: z.object({
		mode: z.enum(["task", "chat"]).optional(),
		enabled: z.boolean().optional(),
		limit: z.number().int().positive().max(100).optional(),
	}),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const where: Record<string, unknown> = {};
	if (input.mode) where.mode = input.mode;
	if (input.enabled !== undefined) where.enabled = input.enabled;

	const result = await ctx.collections.schedules.find({
		where,
		limit: input.limit ?? 50,
		orderBy: { nextRunAt: "asc" },
	});
	return mcpJson(result.docs);
});

export const scheduleGet = mcpTool("schedule_get", {
	title: "Get schedule",
	description: "Get a schedule by id.",
	inputSchema: z.object({ id: z.string().min(1) }),
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const schedule = await ctx.collections.schedules.findOne({
		where: { id: input.id },
	});
	if (!schedule) throw ApiError.notFound("Schedule", input.id);
	return mcpJson(schedule);
});

export const scheduleTrigger = mcpTool("schedule_trigger", {
	title: "Trigger schedule",
	description:
		"Manually trigger a schedule, creating its next execution immediately.",
	inputSchema: z.object({
		id: z.string().min(1).describe("Schedule id"),
	}),
	annotations: { destructiveHint: false, idempotentHint: false },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const schedule = await ctx.collections.schedules.findOne({
		where: { id: input.id },
	});
	if (!schedule) throw ApiError.notFound("Schedule", input.id);

	const now = new Date();
	await ctx.collections.schedules.update({
		where: { id: input.id },
		data: { nextRunAt: now },
	});

	return mcpJson({
		schedule_id: input.id,
		next_run_at: now.toISOString(),
		message: "Schedule next run set to now; it will be picked up by the next tick.",
	});
});
