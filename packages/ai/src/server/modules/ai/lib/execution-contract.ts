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
	/**
	 * Authenticated executor-audience authority issued after this exact Worker
	 * lease was claimed. The sealed envelope carries no ambient credentials or
	 * filesystem authority; the executor boundary must revalidate it.
	 */
	workloadAuthority?: AgentWorkloadClaimAuthority;
}

export interface AgentWorkloadClaimAuthority {
	readonly authority: string;
	readonly attemptId: string;
}

export interface AgentRuntimeRunRequest {
	runtime: string;
	prompt: string;
	runtimeSessionRef?: string;
	systemPrompt?: string;
	mcpServers?: unknown[];
	metadata?: Record<string, unknown>;
}
