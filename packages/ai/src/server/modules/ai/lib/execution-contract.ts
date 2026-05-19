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
	runId: string;
	leaseId: string;
	expiresAt: Date;
	prompt: string;
	runtime: string;
	runtimeSessionRef?: string;
	mcpServers?: unknown[];
	systemPrompt?: string;
	context?: string;
	metadata?: Record<string, unknown>;
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

export interface SpawnAgentRunRequest {
	runtime: string;
	prompt: string;
	runtimeSessionRef?: string;
	cwd?: string;
	systemPrompt?: string;
	mcpServers?: unknown[];
	metadata?: Record<string, unknown>;
}

export interface SpawnAgentRunHandle {
	events: AsyncIterable<Record<string, unknown>>;
	completion: Promise<Record<string, unknown>>;
}

export interface SpawnAgentRunner {
	run(input: SpawnAgentRunRequest): Promise<SpawnAgentRunHandle>;
}
