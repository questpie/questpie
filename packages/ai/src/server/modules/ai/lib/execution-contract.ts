export type AiRunStatus =
	| "pending"
	| "claimed"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export type AiWorkerStatus = "online" | "offline" | "busy" | "draining";

export type AiLeaseStatus = "active" | "completed" | "expired" | "released";

export type AiRunEventLevel = "debug" | "info" | "warn" | "error";

export interface SpawnRunInput {
	prompt: string;
	runtime?: string | null;
	runtimeSessionRef?: string | null;
	systemPrompt?: string | null;
	metadata?: Record<string, unknown>;
}

export interface SpawnedRun {
	runId: string;
}

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
}

export interface CompleteRunInput {
	runId: string;
	workerId: string;
	result: {
		text?: string;
		sessionRef?: string;
		inputTokens?: number;
		outputTokens?: number;
		cost?: number;
		stopReason?: string;
	};
}

export interface FailRunInput {
	runId: string;
	workerId: string;
	error: unknown;
}

export interface ReportRunEventInput {
	runId: string;
	event: Record<string, unknown>;
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

export interface AgentRuntimeRunHandle {
	events: AsyncIterable<Record<string, unknown>>;
	completion: Promise<Record<string, unknown>>;
}

export interface AgentRuntimeRunner {
	run(input: AgentRuntimeRunRequest): Promise<AgentRuntimeRunHandle>;
}

/**
 * @deprecated Use AgentRuntimeRunRequest. The worker runtime is no longer
 * assumed to be spawn-agent; spawn-agent remains one fallback implementation.
 */
export type SpawnAgentRunRequest = AgentRuntimeRunRequest;

/**
 * @deprecated Use AgentRuntimeRunHandle.
 */
export type SpawnAgentRunHandle = AgentRuntimeRunHandle;

/**
 * @deprecated Use AgentRuntimeRunner.
 */
export type SpawnAgentRunner = AgentRuntimeRunner;
