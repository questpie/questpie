import { describe, expect, it } from "bun:test";

import {
	createAgentWorkloadPrincipalResolver,
	type AuthenticatedAgentWorkloadEnvelope,
} from "@questpie/ai";

import { createAgentWorkloadSandboxBoundary } from "../src/exports/index.js";
import {
	activeSandboxAuthority,
	sandboxAuthorityFixture,
	sandboxPolicy,
} from "./agent-workload-fixture.js";

const NOW = new Date("2026-07-19T09:00:00.000Z");

describe("Agent workload sandbox boundary", () => {
	it("rejects a missing or forged authenticated workload before creating a sandbox", async () => {
		let authorityReads = 0;
		const resolver = createAgentWorkloadPrincipalResolver({
			audience: "sandbox",
			authorityStore: {
				async loadFreshConsistentAuthority() {
					authorityReads += 1;
					return null;
				},
			},
			now: () => NOW,
		});
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});

		await expect(
			boundary.open({} as AuthenticatedAgentWorkloadEnvelope),
		).rejects.toEqual(
			expect.objectContaining({
				name: "AgentWorkloadAuthorityError",
				code: "invalid_principal",
			}),
		);
		expect(authorityReads).toBe(0);
	});

	it("requires the opaque authenticated envelope instead of accepting a direct trusted principal", async () => {
		const fixture = await sandboxAuthorityFixture();
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});

		await expect(boundary.open(fixture.principal as never)).rejects.toEqual(
			expect.objectContaining({ code: "invalid_principal" }),
		);
		expect(fixture.reads()).toBe(1);
	});

	it("opens an exact task-scoped session without ambient process authority", async () => {
		const fixture = await sandboxAuthorityFixture();
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});

		const session = await boundary.open(fixture.authority);
		const creation = await session.create(async ({ context, principal }) => ({
			context,
			runId: principal.run.id,
			workerLeaseId: principal.execution.workerLeaseId,
		}));

		expect(creation.context).toEqual({
			workRoot:
				"/var/lib/questpie/workloads/company_hreben/request_marketing_launch/attempt_01",
			cwd: "/work",
			environment: {},
			disclosure: {
				mode: "anchor_space",
				anchorSpaceId: "space_marketing",
			},
			execution: sandboxPolicy().execution,
		});
		expect(creation.runId).toBe("run_marketing_launch");
		expect(creation.workerLeaseId).toBe("lease_run_marketing_launch");
		expect(fixture.reads()).toBe(3);
	});

	it("denies a policy outside the pinned workload without leaking the hidden target", async () => {
		const fixture = await sandboxAuthorityFixture();
		const audit: unknown[] = [];
		const hiddenSkill = "skill_other_company_secret_campaign";
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			audit: (event) => {
				audit.push(event);
			},
			policy: {
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				skillRevisionId: hiddenSkill,
				executionPolicyRevisionId: "execution_policy_autopilot_v5",
				execution: sandboxPolicy().execution,
				filesystem: { read: [], write: [] },
				network: { fetch: [], import: [] },
				secrets: [],
				tools: [],
				effects: [],
				disclosure: {
					mode: "anchor_space",
					anchorSpaceId: "space_marketing",
				},
			},
		});

		let denial: unknown;
		try {
			await boundary.open(fixture.authority);
		} catch (error) {
			denial = error;
		}

		expect(denial).toEqual(
			expect.objectContaining({
				name: "AgentWorkloadSandboxDeniedError",
				code: "sandbox_authority_denied",
				message: "The workload is not authorized for this sandbox operation.",
			}),
		);
		expect(JSON.stringify(denial)).not.toContain(hiddenSkill);
		expect(audit).toEqual([
			{
				boundary: "sandbox.open",
				decision: "denied",
				reason: "policy_mismatch",
				principalId: "principal_run_marketing_launch",
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
				agentActorId: "actor_autopilot",
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				workerId: "worker_embedded_01",
				workerLeaseId: "lease_run_marketing_launch",
			},
		]);
	});

	it("exposes only explicit guest handles and no HOME, cwd, environment, secret value, or provider credential", async () => {
		const fixture = await sandboxAuthorityFixture();
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});

		const session = await boundary.open(fixture.authority);

		expect(session.guest).toEqual({
			cwd: "/work",
			environment: {},
			handles: {
				filesystem: {
					read: ["inputs/**"],
					write: ["outputs/**"],
				},
				network: { fetch: ["api.example.com:443"], import: [] },
				secrets: ["campaign-api"],
				tools: ["tasks.get"],
				effects: ["message.create"],
				disclosure: {
					mode: "anchor_space",
					anchorSpaceId: "space_marketing",
				},
			},
		});
		const serializedGuest = JSON.stringify(session.guest);
		expect(serializedGuest).not.toContain("/var/lib/questpie");
		expect(serializedGuest).not.toContain(process.cwd());
		expect(serializedGuest).not.toContain("provider_anthropic_hreben");
		expect(serializedGuest).not.toContain("secret-value-not-a-handle");
	});

	it("rejects a workload issued for a different audience before sandbox admission", async () => {
		const fixture = await sandboxAuthorityFixture({
			authorityAudience: "executor",
		});
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});

		await expect(boundary.open(fixture.authority)).rejects.toEqual(
			expect.objectContaining({ code: "principal_wrong_audience" }),
		);
		expect(fixture.reads()).toBe(1);
	});

	it("revalidates expiry, revocation, terminal state, and the Worker lease at admission", async () => {
		const cases = [
			{
				code: "principal_expired",
				mutate: (
					fixture: Awaited<ReturnType<typeof sandboxAuthorityFixture>>,
				) => fixture.setNow(new Date("2026-07-19T09:05:00.000Z")),
			},
			{
				code: "authority_epoch_stale",
				mutate: (
					fixture: Awaited<ReturnType<typeof sandboxAuthorityFixture>>,
				) => {
					const record = activeSandboxAuthority();
					fixture.setRecord({
						...record,
						currentEpochs: { ...record.currentEpochs, revocation: 4 },
					});
				},
			},
			{
				code: "run_attempt_terminal",
				mutate: (
					fixture: Awaited<ReturnType<typeof sandboxAuthorityFixture>>,
				) => {
					const record = activeSandboxAuthority();
					fixture.setRecord({
						...record,
						run: { ...record.run, status: "cancelled" },
					});
				},
			},
			{
				code: "worker_lease_stale",
				mutate: (
					fixture: Awaited<ReturnType<typeof sandboxAuthorityFixture>>,
				) => {
					const record = activeSandboxAuthority();
					fixture.setRecord({
						...record,
						execution: {
							...record.execution,
							currentWorkerLeaseId: "lease_reassigned",
							currentWorkerLeaseEpoch: 12,
						},
					});
				},
			},
		] as const;

		for (const testCase of cases) {
			const fixture = await sandboxAuthorityFixture();
			const boundary = createAgentWorkloadSandboxBoundary({
				resolver: fixture.resolver,
				workRootBase: "/var/lib/questpie/workloads",
				policy: sandboxPolicy(),
			});
			testCase.mutate(fixture);

			await expect(boundary.open(fixture.authority)).rejects.toEqual(
				expect.objectContaining({ code: testCase.code }),
			);
		}
	});
});
