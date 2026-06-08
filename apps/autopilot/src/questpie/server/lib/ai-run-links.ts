import { randomUUID } from "node:crypto";

import type { WorkflowContextCollections } from "./app-types";
import { asRecord } from "./records";
import type { RuntimeResolution } from "./runtime-selection";

type InitiatedBy = "chat" | "task" | "schedule" | "workflow" | "manual" | "mcp";

type CreateAiRunLinkInput = {
	ctx: WorkflowContextCollections;
	runtime: RuntimeResolution;
	initiatedBy: InitiatedBy;
	instructions: string;
	taskId?: string | null;
	projectId?: string | null;
	chatSessionId?: string | null;
	chatMessageId?: string | null;
	workflowInstanceId?: string | null;
	scheduleId?: string | null;
	scheduleExecutionId?: string | null;
	runtimeSessionRef?: string | null;
	systemPrompt?: string | null;
	resumedFromRunId?: string | null;
	resumable?: boolean;
	spawnMetadata?: Record<string, unknown>;
	linkMetadata?: Record<string, unknown>;
};

function aiRuntime(runtime: RuntimeResolution["runtime"]) {
	if (runtime === "claude-code" || runtime === "codex") return runtime;
	throw new Error(`Unsupported AI runtime for ai_runs: ${runtime}`);
}

export async function createAiRunLink(input: CreateAiRunLinkInput) {
	const linkId = randomUUID();
	const runtime = aiRuntime(input.runtime.runtime);
	const aiRun = await input.ctx.collections.ai_runs.create({
		status: "pending",
		runtime,
		prompt: input.instructions,
		systemPrompt: input.systemPrompt ?? undefined,
		runtimeSessionRef: input.runtimeSessionRef ?? undefined,
		meta: asRecord(input.spawnMetadata),
	});

	return input.ctx.collections.run_links.create({
		id: linkId,
		aiRun: aiRun.id,
		task: input.taskId ?? undefined,
		project: input.projectId ?? undefined,
		workflowInstanceId: input.workflowInstanceId ?? undefined,
		schedule: input.scheduleId ?? undefined,
		scheduleExecution: input.scheduleExecutionId ?? undefined,
		chatSession: input.chatSessionId ?? undefined,
		chatMessage: input.chatMessageId ?? undefined,
		initiatedBy: input.initiatedBy,
		provider: input.runtime.providerId ?? undefined,
		model: input.runtime.modelId ?? undefined,
		runtime: input.runtime.runtime,
		status: "pending",
		instructions: input.instructions,
		runtimeSessionRef: input.runtimeSessionRef ?? undefined,
		resumedFromRun: input.resumedFromRunId ?? undefined,
		resumable: input.resumable ?? false,
		metadata: asRecord(input.linkMetadata),
	});
}
