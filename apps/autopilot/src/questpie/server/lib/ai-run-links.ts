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
	resumedFromRunId?: string | null;
	resumable?: boolean;
	spawnMetadata?: Record<string, unknown>;
	linkMetadata?: Record<string, unknown>;
};

export async function createAiRunLink(input: CreateAiRunLinkInput) {
	const linkId = randomUUID();
	const spawn = asRecord(input.spawnMetadata);
	const cwd = typeof spawn.cwd === "string" ? spawn.cwd : undefined;

	// Harness producer path: the run_links row is the single execution record —
	// there is no ai_runs row and no worker-claim relay for tasks anymore. `cwd`
	// rides `metadata` so task-turn-producer can run the harness turn straight from
	// the link (skills are harness-native, not baked here). `aiRun` is unset.
	return input.ctx.collections.run_links.create({
		id: linkId,
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
		metadata: {
			...asRecord(input.linkMetadata),
			cwd: cwd ?? null,
		},
	});
}
