import { describe, expect, it } from "bun:test";

import {
	AgentWorkloadAuthorityError,
	type AgentWorkloadAuthorityRecord,
} from "../exports/index.js";
import { activeAuthority, resolverFor } from "./agent-workload-fixture.js";

describe("Agent workload principal resolver", () => {
	it("derives a deeply immutable exact-scope snapshot from persisted bindings", async () => {
		const principal = await resolverFor().resolve({
			runId: "run_marketing_launch",
			attemptId: "attempt_01",
		});

		expect(principal).toMatchObject({
			kind: "agent_workload",
			principalId: "principal_run_marketing_launch",
			audience: "executor",
			run: {
				id: "run_marketing_launch",
				attemptId: "attempt_01",
				rootRunId: "run_marketing_launch",
				parentRunId: null,
				delegationDepth: 0,
				lineageFingerprint: "lineage:marketing-launch",
			},
			attribution: {
				agentActorId: "actor_autopilot",
				requesterActorId: "actor_lucia",
			},
			scope: {
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
			},
			disclosure: {
				mode: "anchor_space",
				anchorSpaceId: "space_marketing",
			},
			epochs: { grant: 7, revocation: 3 },
			issuedAt: "2026-07-19T09:00:00.000Z",
			expiresAt: "2026-07-19T09:05:00.000Z",
		});
		expect(principal.grants.anchorSpace).toEqual([
			"messages.read",
			"messages.create",
			"tasks.read",
		]);
		expect(Object.isFrozen(principal)).toBe(true);
		expect(Object.isFrozen(principal.grants)).toBe(true);
		expect(Object.isFrozen(principal.grants.anchorSpace)).toBe(true);
		expect(() => {
			(principal.grants.anchorSpace as string[]).push("*");
		}).toThrow();
	});

	it("rejects caller-authored authority fields before persistence lookup", async () => {
		let reads = 0;
		const resolve = resolverFor(activeAuthority(), () => reads++)
			.resolve as unknown as (
			input: Record<string, unknown>,
		) => Promise<unknown>;

		await expect(
			resolve({
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
				companyId: "company_forged",
				spaceId: "space_forged",
				agentActorId: "agent_forged",
				grants: ["*"],
				skillRevisionId: "skill_forged",
				runtime: "unrestricted",
				audience: "effect",
				expiresAt: "2999-01-01T00:00:00.000Z",
				grantEpoch: 999,
				revocationEpoch: 0,
				workerLeaseId: "lease_forged",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				name: "AgentWorkloadAuthorityError",
				code: "invalid_resolution_input",
			}),
		);
		expect(reads).toBe(0);
	});

	it("fails closed when the persisted Agent is not active", async () => {
		const record = activeAuthority();
		const inactive: AgentWorkloadAuthorityRecord = {
			...record,
			agent: { ...record.agent, status: "suspended" },
		};

		await expect(
			resolverFor(inactive).resolve({
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				code: "agent_unavailable",
			}),
		);
	});

	it("requires active Company participation and exact active anchor-Space membership", async () => {
		const base = activeAuthority();
		const cases: Array<{
			record: AgentWorkloadAuthorityRecord;
			code: AgentWorkloadAuthorityError["code"];
		}> = [
			{
				record: {
					...base,
					company: { ...base.company, status: "archived" },
				},
				code: "company_unavailable",
			},
			{
				record: {
					...base,
					company: { ...base.company, membershipStatus: "suspended" },
				},
				code: "company_membership_inactive",
			},
			{
				record: {
					...base,
					anchorSpace: { ...base.anchorSpace, status: "archived" },
				},
				code: "anchor_space_unavailable",
			},
			{
				record: {
					...base,
					anchorSpace: {
						...base.anchorSpace,
						membershipStatus: "missing",
					},
				},
				code: "space_membership_inactive",
			},
		];

		for (const testCase of cases) {
			await expect(
				resolverFor(testCase.record).resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: testCase.code,
				}),
			);
		}
	});

	it("requires the exact pinned Skill and request/execution policies to remain usable", async () => {
		const base = activeAuthority();
		const cases: Array<{
			record: AgentWorkloadAuthorityRecord;
			code: AgentWorkloadAuthorityError["code"];
		}> = [
			{
				record: {
					...base,
					policies: { ...base.policies, skillStatus: "incompatible" },
				},
				code: "skill_incompatible",
			},
			{
				record: {
					...base,
					policies: {
						...base.policies,
						requestPolicyStatus: "archived",
					},
				},
				code: "policy_unavailable",
			},
			{
				record: {
					...base,
					policies: {
						...base.policies,
						executionPolicyStatus: "missing",
					},
				},
				code: "policy_unavailable",
			},
		];

		for (const testCase of cases) {
			await expect(
				resolverFor(testCase.record).resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: testCase.code,
				}),
			);
		}
	});

	it("requires a compatible Worker and the exact current active lease", async () => {
		const base = activeAuthority();
		const cases: Array<{
			record: AgentWorkloadAuthorityRecord;
			code: AgentWorkloadAuthorityError["code"];
		}> = [
			{
				record: {
					...base,
					execution: { ...base.execution, workerStatus: "offline" },
				},
				code: "worker_incompatible",
			},
			{
				record: {
					...base,
					execution: { ...base.execution, workerSupportsRuntime: false },
				},
				code: "worker_incompatible",
			},
			{
				record: {
					...base,
					execution: {
						...base.execution,
						currentWorkerLeaseId: "lease_reassigned",
					},
				},
				code: "worker_lease_stale",
			},
			{
				record: {
					...base,
					execution: {
						...base.execution,
						currentWorkerLeaseEpoch: 12,
					},
				},
				code: "worker_lease_stale",
			},
			{
				record: {
					...base,
					execution: { ...base.execution, workerLeaseStatus: "expired" },
				},
				code: "worker_lease_stale",
			},
			{
				record: {
					...base,
					execution: {
						...base.execution,
						workerLeaseExpiresAt: "2026-07-19T08:59:59.000Z",
					},
				},
				code: "worker_lease_stale",
			},
		];

		for (const testCase of cases) {
			await expect(
				resolverFor(testCase.record).resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: testCase.code,
				}),
			);
		}
	});

	it("rejects terminal attempts and stale grant or revocation epochs", async () => {
		const base = activeAuthority();
		const cases: Array<{
			record: AgentWorkloadAuthorityRecord;
			code: AgentWorkloadAuthorityError["code"];
		}> = [
			{
				record: { ...base, run: { ...base.run, status: "completed" } },
				code: "run_attempt_terminal",
			},
			{
				record: {
					...base,
					currentEpochs: { ...base.currentEpochs, grant: 8 },
				},
				code: "authority_epoch_stale",
			},
			{
				record: {
					...base,
					currentEpochs: { ...base.currentEpochs, revocation: 4 },
				},
				code: "authority_epoch_stale",
			},
		];

		for (const testCase of cases) {
			await expect(
				resolverFor(testCase.record).resolve({
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: testCase.code,
				}),
			);
		}
	});
});
