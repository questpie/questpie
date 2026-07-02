export type AiRunStatus =
	| "pending"
	| "claimed"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export type AiWorkerStatus = "online" | "offline" | "busy" | "draining";

export type AiLeaseStatus = "active" | "completed" | "expired" | "released";

export interface WorkerRuntime {
	runtime: string;
	maxConcurrent?: number;
}

export interface ClaimRunInput {
	workerId: string;
	runtimes: string[];
	limit?: number;
}

export interface ClaimedRun {
	lease: {
		id: string;
		runId: string;
		expiresAt: Date;
	};
	spawn: AgentRuntimeRunRequest;
	/**
	 * The claimed `run_links` row (the single execution record) + the
	 * producerLease epoch the worker fences on. The worker runs runHarnessRun +
	 * the ONE finalizeRun against these.
	 */
	run?: Record<string, unknown>;
	epoch?: number;
}

export interface AgentRuntimeRunRequest {
	runtime: string;
	prompt: string;
	runtimeSessionRef?: string;
	cwd?: string;
	systemPrompt?: string;
	mcpServers?: unknown[];
	metadata?: Record<string, unknown>;
}
