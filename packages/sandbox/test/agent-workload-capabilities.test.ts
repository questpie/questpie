import { describe, expect, it } from "bun:test";

import { createAgentWorkloadSandboxBoundary } from "../src/exports/index.js";
import {
	activeSandboxAuthority,
	sandboxAuthorityFixture,
	sandboxPolicy,
} from "./agent-workload-fixture.js";

describe("Agent workload sandbox privileged operations", () => {
	it("revalidates the cancellation fence immediately before sandbox creation", async () => {
		const fixture = await sandboxAuthorityFixture();
		const audit: unknown[] = [];
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
			audit: (event) => {
				audit.push(event);
			},
		});
		const session = await boundary.open(fixture.authority);
		const record = activeSandboxAuthority();
		fixture.setRecord({
			...record,
			run: { ...record.run, status: "cancelled" },
		});
		let creations = 0;

		await expect(
			session.create(async () => {
				creations += 1;
			}),
		).rejects.toEqual(
			expect.objectContaining({ code: "run_attempt_terminal" }),
		);
		expect(creations).toBe(0);
		expect(fixture.reads()).toBe(3);
		expect(audit).toEqual([
			expect.objectContaining({
				boundary: "sandbox.create",
				decision: "denied",
				reason: "authority_invalidated",
				principalId: "principal_run_marketing_launch",
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
			}),
		]);
	});

	it("revalidates and allows only the exact filesystem, network, secret, tool, and effect handles", async () => {
		const fixture = await sandboxAuthorityFixture();
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
		});
		const session = await boundary.open(fixture.authority);
		const requests = [
			{ kind: "filesystem", operation: "read", resource: "inputs/brief.md" },
			{ kind: "filesystem", operation: "write", resource: "outputs/draft.md" },
			{ kind: "network", operation: "fetch", resource: "api.example.com:443" },
			{ kind: "secret", operation: "read", resource: "campaign-api" },
			{ kind: "tool", operation: "call", resource: "tasks.get" },
			{ kind: "effect", operation: "commit", resource: "message.create" },
		] as const;
		const used: string[] = [];

		for (const request of requests) {
			await session.useCapability(request, async ({ guest }) => {
				used.push(`${request.kind}:${request.operation}`);
				expect(guest.cwd).toBe("/work");
				expect(guest.environment).toEqual({});
			});
		}

		expect(used).toEqual([
			"filesystem:read",
			"filesystem:write",
			"network:fetch",
			"secret:read",
			"tool:call",
			"effect:commit",
		]);
		expect(fixture.reads()).toBe(8);
	});

	it("denies out-of-policy bindings and effects without leaking hidden targets", async () => {
		const fixture = await sandboxAuthorityFixture();
		const audit: unknown[] = [];
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
			audit: (event) => {
				audit.push(event);
			},
		});
		const session = await boundary.open(fixture.authority);
		const denied = [
			{ kind: "filesystem", operation: "read", resource: "../../etc/passwd" },
			{ kind: "filesystem", operation: "write", resource: "/tmp/escape" },
			{ kind: "network", operation: "fetch", resource: "169.254.169.254:80" },
			{ kind: "network", operation: "import", resource: "evil.example:443" },
			{ kind: "secret", operation: "read", resource: "provider-master-key" },
			{ kind: "tool", operation: "call", resource: "admin.delete-company" },
			{ kind: "effect", operation: "commit", resource: "message.delete" },
		] as const;
		let privilegedCalls = 0;

		for (const request of denied) {
			await expect(
				session.useCapability(request, async () => {
					privilegedCalls += 1;
				}),
			).rejects.toEqual(
				expect.objectContaining({
					code: "sandbox_authority_denied",
					message: "The workload is not authorized for this sandbox operation.",
				}),
			);
		}

		expect(privilegedCalls).toBe(0);
		expect(audit).toHaveLength(denied.length);
		expect(audit).toEqual(
			denied.map((request) => ({
				boundary:
					request.kind === "effect" ? "sandbox.effect" : "sandbox.binding",
				decision: "denied",
				reason: "capability_denied",
				capability: request.kind,
				principalId: "principal_run_marketing_launch",
				runId: "run_marketing_launch",
				attemptId: "attempt_01",
				agentActorId: "actor_autopilot",
				companyId: "company_hreben",
				anchorSpaceId: "space_marketing",
				workerId: "worker_embedded_01",
				workerLeaseId: "lease_run_marketing_launch",
			})),
		);
		const serializedAudit = JSON.stringify(audit);
		for (const request of denied) {
			expect(serializedAudit).not.toContain(request.resource);
		}
	});

	it("fences every privileged binding and effect after revocation, cancellation, or lease reassignment", async () => {
		const base = activeSandboxAuthority();
		const cases = [
			{
				code: "authority_epoch_stale",
				request: {
					kind: "filesystem",
					operation: "read",
					resource: "inputs/brief.md",
				} as const,
				record: {
					...base,
					currentEpochs: { ...base.currentEpochs, revocation: 4 },
				},
			},
			{
				code: "run_attempt_terminal",
				request: {
					kind: "tool",
					operation: "call",
					resource: "tasks.get",
				} as const,
				record: {
					...base,
					run: { ...base.run, status: "cancelled" as const },
				},
			},
			{
				code: "worker_lease_stale",
				request: {
					kind: "effect",
					operation: "commit",
					resource: "message.create",
				} as const,
				record: {
					...base,
					execution: {
						...base.execution,
						currentWorkerLeaseId: "lease_reassigned",
						currentWorkerLeaseEpoch: 12,
					},
				},
			},
		] as const;

		for (const testCase of cases) {
			const fixture = await sandboxAuthorityFixture();
			const audit: unknown[] = [];
			const boundary = createAgentWorkloadSandboxBoundary({
				resolver: fixture.resolver,
				workRootBase: "/var/lib/questpie/workloads",
				policy: sandboxPolicy(),
				audit: (event) => {
					audit.push(event);
				},
			});
			const session = await boundary.open(fixture.authority);
			fixture.setRecord(testCase.record);
			let privilegedCalls = 0;

			await expect(
				session.useCapability(testCase.request, async () => {
					privilegedCalls += 1;
				}),
			).rejects.toEqual(expect.objectContaining({ code: testCase.code }));
			expect(privilegedCalls).toBe(0);
			expect(audit).toEqual([
				expect.objectContaining({
					boundary:
						testCase.request.kind === "effect"
							? "sandbox.effect"
							: "sandbox.binding",
					decision: "denied",
					reason: "authority_invalidated",
					capability: testCase.request.kind,
					principalId: "principal_run_marketing_launch",
					runId: "run_marketing_launch",
					attemptId: "attempt_01",
				}),
			]);
			expect(JSON.stringify(audit)).not.toContain(testCase.request.resource);
		}
	});

	it("records redacted attributable authorization before a privileged effect commits", async () => {
		const fixture = await sandboxAuthorityFixture();
		const sequence: string[] = [];
		const audit: unknown[] = [];
		const boundary = createAgentWorkloadSandboxBoundary({
			resolver: fixture.resolver,
			workRootBase: "/var/lib/questpie/workloads",
			policy: sandboxPolicy(),
			audit: (event) => {
				audit.push(event);
				sequence.push("audit:allowed");
			},
		});
		const session = await boundary.open(fixture.authority);

		await session.useCapability(
			{ kind: "effect", operation: "commit", resource: "message.create" },
			async () => {
				sequence.push("effect:commit");
			},
		);

		expect(sequence).toEqual(["audit:allowed", "effect:commit"]);
		expect(audit).toEqual([
			{
				boundary: "sandbox.effect",
				decision: "allowed",
				reason: "capability_authorized",
				capability: "effect",
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
		expect(JSON.stringify(audit)).not.toContain("message.create");
	});
});
