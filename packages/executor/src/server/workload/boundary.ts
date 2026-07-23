import { ExecutorWorkloadAuthorityError } from "./error.js";
import type {
	AgentWorkloadExecutionFence,
	AgentWorkloadExecutionOperation,
	AgentWorkloadExecutionRequest,
	AgentWorkloadExecutorBoundary,
	AgentWorkloadExecutorBoundaryOptions,
} from "./types.js";

function exactKeys(value: object, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return (
		actual.length === expected.length &&
		actual.every((key, index) => key === expected[index])
	);
}

function assertFence(
	value: unknown,
): asserts value is AgentWorkloadExecutionFence {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value, [
			"runId",
			"attemptId",
			"workerId",
			"leaseId",
			"leaseEpoch",
		])
	) {
		throw new ExecutorWorkloadAuthorityError("invalid_principal");
	}
	const fence = value as Record<string, unknown>;
	if (
		typeof fence.runId !== "string" ||
		fence.runId.length === 0 ||
		typeof fence.attemptId !== "string" ||
		fence.attemptId.length === 0 ||
		typeof fence.workerId !== "string" ||
		fence.workerId.length === 0 ||
		typeof fence.leaseId !== "string" ||
		fence.leaseId.length === 0 ||
		typeof fence.leaseEpoch !== "number" ||
		!Number.isSafeInteger(fence.leaseEpoch) ||
		fence.leaseEpoch < 0
	) {
		throw new ExecutorWorkloadAuthorityError("invalid_principal");
	}
}

function assertRequest(
	value: unknown,
): asserts value is AgentWorkloadExecutionRequest {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!exactKeys(value, ["authority", "fence"])
	) {
		throw new ExecutorWorkloadAuthorityError("invalid_principal");
	}
	const request = value as Record<string, unknown>;
	if (typeof request.authority !== "string" || request.authority.length === 0) {
		throw new ExecutorWorkloadAuthorityError("invalid_principal");
	}
	assertFence(request.fence);
}

function assertPrincipalMatchesFence(
	principal: Awaited<
		ReturnType<AgentWorkloadExecutorBoundaryOptions["resolver"]["validate"]>
	>,
	fence: AgentWorkloadExecutionFence,
): void {
	if (
		principal.run.id !== fence.runId ||
		principal.run.attemptId !== fence.attemptId
	) {
		throw new ExecutorWorkloadAuthorityError("invalid_principal");
	}
	if (principal.execution.workerId !== fence.workerId) {
		throw new ExecutorWorkloadAuthorityError("worker_incompatible");
	}
	if (
		principal.execution.workerLeaseId !== fence.leaseId ||
		principal.execution.workerLeaseEpoch !== fence.leaseEpoch
	) {
		throw new ExecutorWorkloadAuthorityError("worker_lease_stale");
	}
}

export function createAgentWorkloadExecutorBoundary(
	options: AgentWorkloadExecutorBoundaryOptions,
): AgentWorkloadExecutorBoundary {
	const authorize = async <TResult>(
		request: AgentWorkloadExecutionRequest,
		operation: AgentWorkloadExecutionOperation<TResult>,
	): Promise<TResult> => {
		assertRequest(request);
		const envelope = options.transport.open(request.authority);
		const principal = await options.resolver.validate(envelope);
		assertPrincipalMatchesFence(principal, request.fence);
		return operation(principal);
	};

	return {
		start: authorize,
		resume: authorize,
		rpc: authorize,
		handoffResult: authorize,
	};
}
