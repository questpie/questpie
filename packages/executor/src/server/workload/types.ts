export interface ExecutorAgentWorkloadPrincipal {
	readonly principalId: string;
	readonly run: { readonly id: string; readonly attemptId: string };
	readonly attribution: {
		readonly agentActorId: string;
		readonly requesterActorId: string;
	};
	readonly execution: {
		readonly workerId: string;
		readonly workerLeaseId: string;
		readonly workerLeaseEpoch: number;
	};
}

export interface AgentWorkloadExecutionFence {
	readonly runId: string;
	readonly attemptId: string;
	readonly workerId: string;
	readonly leaseId: string;
	readonly leaseEpoch: number;
}

export interface AgentWorkloadExecutionRequest {
	readonly authority: string;
	readonly fence: AgentWorkloadExecutionFence;
}

export type AgentWorkloadExecutionOperation<TResult> = (
	principal: ExecutorAgentWorkloadPrincipal,
) => Promise<TResult> | TResult;

export interface AgentWorkloadExecutorBoundaryOptions {
	readonly resolver: {
		validate(envelope: unknown): Promise<ExecutorAgentWorkloadPrincipal>;
	};
	readonly transport: { open(envelope: string): unknown };
}

export interface AgentWorkloadExecutorBoundary {
	start<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: AgentWorkloadExecutionOperation<TResult>,
	): Promise<TResult>;
	resume<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: AgentWorkloadExecutionOperation<TResult>,
	): Promise<TResult>;
	rpc<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: AgentWorkloadExecutionOperation<TResult>,
	): Promise<TResult>;
	handoffResult<TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: AgentWorkloadExecutionOperation<TResult>,
	): Promise<TResult>;
}
