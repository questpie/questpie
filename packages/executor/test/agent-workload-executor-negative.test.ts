import { describe, expect, it } from "bun:test";

import {
	createAgentWorkloadPrincipalResolver,
	createAuthenticatedAgentWorkloadTransport,
} from "@questpie/ai";

import {
	activeAuthority,
	authoritySnapshot,
} from "../../ai/src/__tests__/agent-workload-fixture.js";
import {
	createExecutorFixture,
	EXECUTOR_NOW,
	EXECUTOR_TRANSPORT_SECRET,
} from "./agent-workload-executor-fixture.js";

async function sealedCurrentAuthority(
	fixture: ReturnType<typeof createExecutorFixture>,
): Promise<string> {
	const principal = await fixture.resolver.resolve({
		runId: fixture.fence.runId,
		attemptId: fixture.fence.attemptId,
	});
	return fixture.transport.seal(principal);
}

describe("Agent workload executor fail-closed matrix", () => {
	it("rejects forged and wrong-audience transport before a persistence read", async () => {
		const fixture = createExecutorFixture();
		const authority = await sealedCurrentAuthority(fixture);
		fixture.resetReads();
		const parts = authority.split(".");
		parts[2] = `${parts[2]}A`;

		await expect(
			fixture.boundary.start(
				{ authority: parts.join("."), fence: fixture.fence },
				async () => undefined,
			),
		).rejects.toEqual(expect.objectContaining({ code: "invalid_principal" }));
		expect(fixture.reads()).toBe(0);

		const wrongAudienceResolver = createAgentWorkloadPrincipalResolver({
			audience: "mcp",
			authorityStore: {
				async loadFreshConsistentAuthority() {
					return authoritySnapshot(activeAuthority());
				},
			},
			now: () => EXECUTOR_NOW,
		});
		const wrongAudiencePrincipal = await wrongAudienceResolver.resolve({
			runId: fixture.fence.runId,
			attemptId: fixture.fence.attemptId,
		});
		const transport = createAuthenticatedAgentWorkloadTransport({
			keyId: "executor-control-plane-v1",
			secret: EXECUTOR_TRANSPORT_SECRET,
		});

		await expect(
			fixture.boundary.start(
				{
					authority: transport.seal(wrongAudiencePrincipal),
					fence: fixture.fence,
				},
				async () => undefined,
			),
		).rejects.toEqual(
			expect.objectContaining({ code: "principal_wrong_audience" }),
		);
		expect(fixture.reads()).toBe(0);
	});

	it("rejects expiry, revocation, cancellation, terminal state, and stale lease before work", async () => {
		const cases = [
			{
				name: "revoked authority",
				code: "authority_epoch_stale",
				mutate: () => {
					const record = activeAuthority();
					return {
						...record,
						run: { ...record.run, revocationEpoch: 4 },
						currentEpochs: { ...record.currentEpochs, revocation: 4 },
					};
				},
			},
			{
				name: "cancelled attempt",
				code: "run_attempt_terminal",
				mutate: () => {
					const record = activeAuthority();
					return {
						...record,
						run: { ...record.run, status: "cancelled" as const },
					};
				},
			},
			{
				name: "completed attempt",
				code: "run_attempt_terminal",
				mutate: () => {
					const record = activeAuthority();
					return {
						...record,
						run: { ...record.run, status: "completed" as const },
					};
				},
			},
			{
				name: "stale worker lease",
				code: "worker_lease_stale",
				mutate: () => {
					const record = activeAuthority();
					return {
						...record,
						execution: {
							...record.execution,
							currentWorkerLeaseEpoch: 12,
						},
					};
				},
			},
		] as const;

		for (const testCase of cases) {
			const fixture = createExecutorFixture();
			const authority = await sealedCurrentAuthority(fixture);
			fixture.setRecord(testCase.mutate());
			fixture.resetReads();
			let operations = 0;

			await expect(
				fixture.boundary.rpc({ authority, fence: fixture.fence }, async () => {
					operations += 1;
				}),
			).rejects.toEqual(expect.objectContaining({ code: testCase.code }));
			expect(operations, testCase.name).toBe(0);
			expect(fixture.reads(), testCase.name).toBe(1);
		}

		const expired = createExecutorFixture();
		const expiredAuthority = await sealedCurrentAuthority(expired);
		expired.setNow(new Date("2026-07-19T09:06:00.000Z"));
		expired.resetReads();
		await expect(
			expired.boundary.rpc(
				{ authority: expiredAuthority, fence: expired.fence },
				async () => undefined,
			),
		).rejects.toEqual(expect.objectContaining({ code: "principal_expired" }));
		expect(expired.reads()).toBe(0);
	});

	it("binds Run, attempt, Worker, lease id, and lease epoch exactly", async () => {
		const fixture = createExecutorFixture();
		const authority = await sealedCurrentAuthority(fixture);
		const cases = [
			["runId", "run_other", "invalid_principal"],
			["attemptId", "attempt_other", "invalid_principal"],
			["workerId", "worker_other", "worker_incompatible"],
			["leaseId", "lease_other", "worker_lease_stale"],
			["leaseEpoch", 12, "worker_lease_stale"],
		] as const;

		for (const [field, value, code] of cases) {
			fixture.resetReads();
			await expect(
				fixture.boundary.handoffResult(
					{
						authority,
						fence: { ...fixture.fence, [field]: value },
					},
					async () => undefined,
				),
			).rejects.toEqual(expect.objectContaining({ code }));
			expect(fixture.reads()).toBe(1);
		}
	});

	it("rejects ambient authority and execution fallbacks before validation", async () => {
		const fixture = createExecutorFixture();
		const authority = await sealedCurrentAuthority(fixture);
		fixture.resetReads();
		const start = fixture.boundary.start as unknown as (
			request: Record<string, unknown>,
			operation: () => Promise<void>,
		) => Promise<void>;

		for (const field of [
			"system",
			"requester",
			"cookie",
			"oauth",
			"cwd",
			"env",
			"credentials",
		]) {
			await expect(
				start(
					{ authority, fence: fixture.fence, [field]: "fallback" },
					async () => undefined,
				),
			).rejects.toEqual(expect.objectContaining({ code: "invalid_principal" }));
		}
		expect(fixture.reads()).toBe(0);
	});

	it("lets only the current leased Worker append, commit, and finalize under concurrency", async () => {
		const fixture = createExecutorFixture();
		const staleAuthority = await sealedCurrentAuthority(fixture);
		const previous = activeAuthority();
		const currentRecord = {
			...previous,
			execution: {
				...previous.execution,
				workerId: "worker_embedded_02",
				workerLeaseWorkerId: "worker_embedded_02",
				workerLeaseId: "lease_run_marketing_launch_current",
				currentWorkerLeaseId: "lease_run_marketing_launch_current",
				workerLeaseEpoch: 12,
				currentWorkerLeaseEpoch: 12,
			},
		} as const;
		fixture.setRecord(currentRecord);
		const currentPrincipal = await fixture.resolver.resolve({
			runId: fixture.fence.runId,
			attemptId: fixture.fence.attemptId,
		});
		const currentAuthority = fixture.transport.seal(currentPrincipal);
		fixture.resetReads();
		const effects: string[] = [];
		const currentFence = {
			...fixture.fence,
			workerId: "worker_embedded_02",
			leaseId: "lease_run_marketing_launch_current",
			leaseEpoch: 12,
		};
		const effectCommit = async () => {
			// The target transaction still owns its own CAS/epoch fence; this callback
			// proves only a freshly executor-authorized Worker can reach it.
			effects.push("append", "commit", "finalize");
		};

		const [stale, current] = await Promise.allSettled([
			fixture.boundary.handoffResult(
				{ authority: staleAuthority, fence: fixture.fence },
				effectCommit,
			),
			fixture.boundary.handoffResult(
				{ authority: currentAuthority, fence: currentFence },
				effectCommit,
			),
		]);

		expect(stale.status).toBe("rejected");
		expect(stale.status === "rejected" ? stale.reason : undefined).toEqual(
			expect.objectContaining({ code: "worker_lease_stale" }),
		);
		expect(current.status).toBe("fulfilled");
		expect(effects).toEqual(["append", "commit", "finalize"]);
		expect(fixture.reads()).toBe(2);
	});
});
