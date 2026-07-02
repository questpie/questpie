import { randomUUID } from "node:crypto";

import type { WorkflowContextCollections } from "./app-types";
import { asRecord } from "./records";
import type { RuntimeResolution } from "./runtime-selection";

type InitiatedBy = "chat" | "task" | "schedule" | "workflow" | "manual" | "mcp";

type CreateAiRunLinkInput = {
	ctx: WorkflowContextCollections & Pick<Questpie.WorkflowContext, "queue">;
	runtime: RuntimeResolution;
	initiatedBy: InitiatedBy;
	// Execution discriminant (distinct from initiatedBy = provenance) — the
	// finalize/claim path branches on this.
	kind?: "chat" | "task" | "schedule" | "workflow" | "mcp" | "manual";
	// Per-row retry decision the reaper consults (T8). Defaults to "none".
	retryPolicy?: "none" | "auto";
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
	// The single resumable-KV stream key for this run, minted up front so the
	// enqueue site + the FE can address the stream before the worker claims it.
	const streamId = `run-stream:${randomUUID()}`;
	const spawn = asRecord(input.spawnMetadata);
	const cwd = typeof spawn.cwd === "string" ? spawn.cwd : undefined;

	// The run_links row is the single execution record a worker claims, streams,
	// and finalizes. `cwd` rides `metadata` so the claiming worker can run the
	// harness turn straight from the link (skills are harness-native, not baked
	// here).
	const created = await input.ctx.collections.run_links.create({
		id: linkId,
		task: input.taskId ?? undefined,
		project: input.projectId ?? undefined,
		workflowInstanceId: input.workflowInstanceId ?? undefined,
		schedule: input.scheduleId ?? undefined,
		scheduleExecution: input.scheduleExecutionId ?? undefined,
		chatSession: input.chatSessionId ?? undefined,
		chatMessage: input.chatMessageId ?? undefined,
		initiatedBy: input.initiatedBy,
		kind: input.kind ?? undefined,
		retryPolicy: input.retryPolicy ?? "none",
		provider: input.runtime.providerId ?? undefined,
		model: input.runtime.modelId ?? undefined,
		runtime: input.runtime.runtime,
		status: "pending",
		instructions: input.instructions,
		activeStreamId: streamId,
		runtimeSessionRef: input.runtimeSessionRef ?? undefined,
		resumedFromRun: input.resumedFromRunId ?? undefined,
		resumable: input.resumable ?? false,
		metadata: {
			...asRecord(input.linkMetadata),
			cwd: cwd ?? null,
		},
	});

	// Best-effort "run-available" kick so an idle worker claims promptly instead
	// of waiting a full poll interval (spec §3.4). The pending row is already the
	// source of truth — a failed kick just means the worker claims on its next
	// poll, so never let it fail run creation.
	try {
		await (input.ctx.queue as any).runAvailable.publish({
			runtime: input.runtime.runtime,
		});
	} catch {
		// swallow — kick is delivery acceleration, not correctness
	}

	return created;
}
