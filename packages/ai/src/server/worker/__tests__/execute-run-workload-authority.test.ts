import { describe, expect, it } from "bun:test";

import {
	activeAuthority,
	authoritySnapshot,
	WORKLOAD_NOW,
} from "../../../__tests__/agent-workload-fixture.js";
import {
	AgentWorkloadAuthorityError,
	type AgentWorkloadPrincipal,
	createAgentWorkloadPrincipalResolver,
	createAuthenticatedAgentWorkloadTransport,
} from "../../../exports/index.js";
import type { ClaimedRun } from "../../modules/ai/lib/execution-contract.js";
import type { QuestpieKVLike } from "../../modules/ai/lib/questpie-resumable-streams.js";
import { executeRun, type ExecuteRunDeps } from "../execute-run.js";

function createTestKV(): QuestpieKVLike {
	const values = new Map<string, unknown>();
	return {
		async get<T>(key: string) {
			return (values.get(key) as T | undefined) ?? null;
		},
		async set(key: string, value: unknown) {
			values.set(key, value);
		},
		async delete(key: string) {
			values.delete(key);
		},
		async has(key: string) {
			return values.has(key);
		},
	};
}

function createWorkerAuthorityFixture() {
	let reads = 0;
	let record = activeAuthority();
	const resolver = createAgentWorkloadPrincipalResolver({
		audience: "executor",
		authorityStore: {
			async loadFreshConsistentAuthority() {
				reads += 1;
				return authoritySnapshot(record);
			},
		},
		now: () => WORKLOAD_NOW,
		principalId: () => "principal_worker_fixture",
	});
	const transport = createAuthenticatedAgentWorkloadTransport({
		keyId: "executor-control-plane-v1",
		secret: new TextEncoder().encode(
			"hreben-executor-workload-transport-key-32-bytes-minimum",
		),
	});
	const authorize = async <TResult>(
		request: {
			authority: string;
			fence: {
				runId: string;
				attemptId: string;
				workerId: string;
				leaseId: string;
				leaseEpoch: number;
			};
		},
		operation: (
			principal: AgentWorkloadPrincipal,
		) => Promise<TResult> | TResult,
	) => {
		const principal = await resolver.validate(
			transport.open(request.authority),
		);
		if (
			principal.run.id !== request.fence.runId ||
			principal.run.attemptId !== request.fence.attemptId ||
			principal.execution.workerId !== request.fence.workerId ||
			principal.execution.workerLeaseId !== request.fence.leaseId ||
			principal.execution.workerLeaseEpoch !== request.fence.leaseEpoch
		) {
			throw new AgentWorkloadAuthorityError("worker_lease_stale");
		}
		return operation(principal);
	};
	return {
		resolver,
		transport,
		boundary: {
			start: authorize,
			resume: authorize,
			handoffResult: authorize,
		},
		fence: {
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
			workerId: "worker_embedded_01",
			leaseId: "lease_run_marketing_launch",
			leaseEpoch: 11,
		},
		reads: () => reads,
		resetReads: () => {
			reads = 0;
		},
		setRecord: (next: ReturnType<typeof activeAuthority>) => {
			record = next;
		},
	};
}

describe("AI Worker workload authority", () => {
	it("validates start and result handoff around one Worker execution", async () => {
		const authority = createWorkerAuthorityFixture();
		const principal = await authority.resolver.resolve({
			runId: authority.fence.runId,
			attemptId: authority.fence.attemptId,
		});
		const sealed = authority.transport.seal(principal);
		authority.resetReads();
		const row: Record<string, unknown> = {
			id: authority.fence.runId,
			kind: "task",
			status: "claimed",
			activeStreamId: "run-stream:authorized",
			runtime: "direct_generation",
			instructions: "Prepare campaign brief",
			producerLease: {
				epoch: authority.fence.leaseEpoch,
				workerId: authority.fence.workerId,
				leaseId: authority.fence.leaseId,
			},
		};
		let harnessCalls = 0;
		const deps = {
			collections: {
				run_links: {
					async update({ data }: { data: Record<string, unknown> }) {
						Object.assign(row, data);
						return [{ ...row }];
					},
					async findOne() {
						return { ...row };
					},
				},
			},
			kv: createTestKV(),
			workerDir: "/managed-worker-root",
			volumeId: "vol_worker",
			workloadBoundary: authority.boundary,
			runHarness: async () => {
				harnessCalls += 1;
				return {
					messageId: "message_authorized",
					summary: "Campaign brief ready",
					tokensInput: 12,
					tokensOutput: 24,
					resumeState: { sessionId: "session_authorized" },
					uiMessages: [],
				};
			},
		} as unknown as ExecuteRunDeps;
		const claimed = {
			lease: {
				id: authority.fence.leaseId,
				runId: authority.fence.runId,
				expiresAt: new Date("2026-07-19T09:10:00.000Z"),
			},
			spawn: { runtime: "direct_generation", prompt: "Prepare campaign brief" },
			run: row,
			epoch: authority.fence.leaseEpoch,
			workloadAuthority: {
				authority: sealed,
				attemptId: authority.fence.attemptId,
			},
		} as unknown as ClaimedRun;

		await executeRun(deps, claimed);

		expect(harnessCalls).toBe(1);
		expect(authority.reads()).toBe(2);
		expect(row.status).toBe("completed");
		expect(row.summary).toBe("Campaign brief ready");
	});

	it("does not retry or finalize when authority becomes stale at result handoff", async () => {
		const authority = createWorkerAuthorityFixture();
		const principal = await authority.resolver.resolve({
			runId: authority.fence.runId,
			attemptId: authority.fence.attemptId,
		});
		const sealed = authority.transport.seal(principal);
		authority.resetReads();
		const row: Record<string, unknown> = {
			id: authority.fence.runId,
			kind: "task",
			status: "claimed",
			activeStreamId: "run-stream:revoked-at-handoff",
			runtime: "direct_generation",
			instructions: "Prepare campaign brief",
			producerLease: {
				epoch: authority.fence.leaseEpoch,
				workerId: authority.fence.workerId,
				leaseId: authority.fence.leaseId,
			},
		};
		let updates = 0;
		const current = activeAuthority();
		const deps = {
			collections: {
				run_links: {
					async update() {
						updates += 1;
						return [{ ...row }];
					},
					async findOne() {
						return { ...row };
					},
				},
			},
			kv: createTestKV(),
			workerDir: "/managed-worker-root",
			volumeId: "vol_worker",
			workloadBoundary: authority.boundary,
			runHarness: async () => {
				authority.setRecord({
					...current,
					run: { ...current.run, revocationEpoch: 4 },
					currentEpochs: { ...current.currentEpochs, revocation: 4 },
				});
				return {
					messageId: "message_revoked",
					summary: "must not commit",
					tokensInput: 1,
					tokensOutput: 1,
					resumeState: null,
					uiMessages: [],
				};
			},
		} as unknown as ExecuteRunDeps;
		const claimed = {
			lease: {
				id: authority.fence.leaseId,
				runId: authority.fence.runId,
				expiresAt: new Date("2026-07-19T09:10:00.000Z"),
			},
			spawn: { runtime: "direct_generation", prompt: "Prepare campaign brief" },
			run: row,
			epoch: authority.fence.leaseEpoch,
			workloadAuthority: {
				authority: sealed,
				attemptId: authority.fence.attemptId,
			},
		} as unknown as ClaimedRun;

		await expect(executeRun(deps, claimed)).rejects.toEqual(
			expect.objectContaining({ code: "authority_epoch_stale" }),
		);
		expect(authority.reads()).toBe(2);
		expect(updates).toBe(0);
		expect(row.status).toBe("claimed");
	});
});
