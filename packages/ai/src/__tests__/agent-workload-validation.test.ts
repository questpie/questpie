import { describe, expect, it } from "bun:test";

import {
	AgentWorkloadAuthorityError,
	createAgentWorkloadPrincipalResolver,
	type AgentWorkloadAuthorityRecord,
} from "../exports/index.js";
import {
	activeAuthority,
	authoritySnapshot,
	resolverFor,
} from "./agent-workload-fixture.js";

describe("Agent workload principal validation", () => {
	it("rejects an expired previously issued principal", async () => {
		let currentTime = new Date("2026-07-19T09:00:00.000Z");
		const resolver = resolverFor(
			activeAuthority(),
			undefined,
			() => currentTime,
		);
		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		currentTime = new Date("2026-07-19T09:05:00.000Z");

		await expect(resolver.validate(principal)).rejects.toEqual(
			expect.objectContaining({
				code: "principal_expired",
			}),
		);
	});

	it("re-reads persistence and rejects authority revoked after issue", async () => {
		let record: AgentWorkloadAuthorityRecord = activeAuthority();
		let reads = 0;
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "effect",
			authorityStore: {
				loadFreshConsistentAuthority: async () => {
					reads += 1;
					return authoritySnapshot(record);
				},
			},
			now: () => new Date("2026-07-19T09:00:00.000Z"),
			principalId: () => "principal_effect_01",
		});
		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		record = {
			...record,
			currentEpochs: { ...record.currentEpochs, revocation: 4 },
		};

		await expect(resolver.validate(principal)).rejects.toEqual(
			expect.objectContaining({
				code: "authority_epoch_stale",
			}),
		);
		expect(reads).toBe(2);
	});

	it("rejects a trusted principal at the wrong boundary audience", async () => {
		const executorResolver = resolverFor();
		const effectResolver = createAgentWorkloadPrincipalResolver({
			audience: "effect",
			authorityStore: {
				loadFreshConsistentAuthority: async () =>
					authoritySnapshot(activeAuthority()),
			},
			now: () => new Date("2026-07-19T09:00:00.000Z"),
		});
		const executorPrincipal = await executorResolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});

		await expect(effectResolver.validate(executorPrincipal)).rejects.toEqual(
			expect.objectContaining({
				code: "principal_wrong_audience",
			}),
		);
	});

	it("rejects a persisted authority snapshot changed without an epoch bump", async () => {
		let record: AgentWorkloadAuthorityRecord = activeAuthority();
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "executor",
			authorityStore: {
				loadFreshConsistentAuthority: async () => authoritySnapshot(record),
			},
			now: () => new Date("2026-07-19T09:00:00.000Z"),
		});
		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});
		record = {
			...record,
			grants: {
				...record.grants,
				anchorSpace: [...record.grants.anchorSpace, "tasks.update"],
			},
		};

		await expect(resolver.validate(principal)).rejects.toEqual(
			expect.objectContaining({
				code: "authority_epoch_stale",
			}),
		);
	});

	it("rechecks status and Worker lease changes at the validation boundary", async () => {
		const base = activeAuthority();
		const cases: Array<{
			mutate: (
				record: AgentWorkloadAuthorityRecord,
			) => AgentWorkloadAuthorityRecord;
			code: AgentWorkloadAuthorityError["code"];
		}> = [
			{
				mutate: (record) => ({
					...record,
					agent: { ...record.agent, status: "archived" },
				}),
				code: "agent_unavailable",
			},
			{
				mutate: (record) => ({
					...record,
					execution: {
						...record.execution,
						currentWorkerLeaseId: "lease_reassigned",
						currentWorkerLeaseEpoch: 12,
					},
				}),
				code: "worker_lease_stale",
			},
		];

		for (const testCase of cases) {
			let record: AgentWorkloadAuthorityRecord = base;
			const resolver = createAgentWorkloadPrincipalResolver({
				audience: "executor",
				authorityStore: {
					loadFreshConsistentAuthority: async () => authoritySnapshot(record),
				},
				now: () => new Date("2026-07-19T09:00:00.000Z"),
			});
			const principal = await resolver.resolve({
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
			});
			record = testCase.mutate(record);

			await expect(resolver.validate(principal)).rejects.toEqual(
				expect.objectContaining({
					code: testCase.code,
				}),
			);
		}
	});

	it("caps issued authority at the five-minute maximum lifetime", async () => {
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				loadFreshConsistentAuthority: async () =>
					authoritySnapshot(activeAuthority()),
			},
			now: () => new Date("2026-07-19T09:00:00.000Z"),
			ttlMs: 60 * 60 * 1000,
		});

		const principal = await resolver.resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});

		expect(principal.expiresAt).toBe("2026-07-19T09:05:00.000Z");
	});
});
