import { describe, expect, it } from "bun:test";

import type { ClaimedRun } from "../../modules/ai/lib/execution-contract.js";
import type { QuestpieKVLike } from "../../modules/ai/lib/questpie-resumable-streams.js";
import { executeRun, type ExecuteRunDeps } from "../execute-run.js";

const lease = {
	id: "lease_run_marketing_launch",
	runId: "run_marketing_launch",
	expiresAt: new Date("2026-07-19T09:10:00.000Z"),
};

function testKV(): QuestpieKVLike {
	return {
		async get() {
			return null;
		},
		async set() {},
		async delete() {},
		async has() {
			return false;
		},
	};
}

function runRow(extra: Record<string, unknown> = {}) {
	return {
		id: lease.runId,
		kind: "task",
		status: "claimed",
		activeStreamId: "run-stream:authority-required",
		runtime: "direct_generation",
		instructions: "Prepare campaign brief",
		producerLease: {
			epoch: 11,
			workerId: "worker_embedded_01",
			leaseId: lease.id,
		},
		...extra,
	};
}

function claim(
	row: Record<string, unknown>,
	withAuthority: boolean,
): ClaimedRun {
	return {
		lease,
		spawn: { runtime: "direct_generation", prompt: "Prepare campaign brief" },
		run: row,
		epoch: 11,
		...(withAuthority
			? {
					workloadAuthority: {
						authority: "authenticated-envelope",
						attemptId: "attempt_01",
					},
				}
			: {}),
	};
}

function depsFor(row: Record<string, unknown>, harness: () => void) {
	let updates = 0;
	const deps = {
		collections: {
			run_links: {
				async update({ data }: { data: Record<string, unknown> }) {
					updates += 1;
					Object.assign(row, data);
					return [{ ...row }];
				},
				async findOne() {
					return { ...row };
				},
			},
		},
		kv: testKV(),
		workerDir: "/managed-worker-root",
		volumeId: "vol_worker",
		runHarness: async () => {
			harness();
			return {
				messageId: "message_authorized",
				summary: "ready",
				tokensInput: 1,
				tokensOutput: 1,
				resumeState: null,
				uiMessages: [],
			};
		},
	} as unknown as ExecuteRunDeps;
	return { deps, updates: () => updates };
}

describe("AI Worker workload boundary configuration", () => {
	it("rejects an authorized Worker claim that has no durable Run row", async () => {
		const row = runRow();
		const { deps } = depsFor(row, () => undefined);
		deps.workloadBoundary = {
			start: async (_request, operation) => operation({} as never),
			resume: async (_request, operation) => operation({} as never),
			handoffResult: async (_request, operation) => operation({} as never),
		};
		const missingRun = claim(row, true);
		missingRun.run = undefined;

		await expect(executeRun(deps, missingRun)).rejects.toEqual(
			expect.objectContaining({ code: "invalid_principal" }),
		);
	});

	it("does not fall back when a configured boundary receives no authority", async () => {
		const row = runRow();
		let harnessCalls = 0;
		const { deps, updates } = depsFor(row, () => harnessCalls++);
		deps.workloadBoundary = {
			start: async (_request, operation) => operation({} as never),
			resume: async (_request, operation) => operation({} as never),
			handoffResult: async (_request, operation) => operation({} as never),
		};

		await expect(executeRun(deps, claim(row, false))).rejects.toEqual(
			expect.objectContaining({ code: "invalid_principal" }),
		);
		expect(harnessCalls).toBe(0);
		expect(updates()).toBe(0);
	});

	it("does not accept authority without the configured executor resolver", async () => {
		const row = runRow();
		let harnessCalls = 0;
		const { deps, updates } = depsFor(row, () => harnessCalls++);

		await expect(executeRun(deps, claim(row, true))).rejects.toEqual(
			expect.objectContaining({ code: "invalid_resolver_configuration" }),
		);
		expect(harnessCalls).toBe(0);
		expect(updates()).toBe(0);
	});

	it("uses resume rather than start and authorizes result handoff separately", async () => {
		const row = runRow({
			harnessResumeState: { sessionId: "session_previous" },
		});
		let harnessCalls = 0;
		let starts = 0;
		let resumes = 0;
		let handoffs = 0;
		const { deps } = depsFor(row, () => harnessCalls++);
		deps.workloadBoundary = {
			start: async (_request, operation) => {
				starts += 1;
				return operation({} as never);
			},
			resume: async (_request, operation) => {
				resumes += 1;
				return operation({} as never);
			},
			handoffResult: async (_request, operation) => {
				handoffs += 1;
				return operation({} as never);
			},
		};

		await executeRun(deps, claim(row, true));

		expect({ starts, resumes, handoffs, harnessCalls }).toEqual({
			starts: 0,
			resumes: 1,
			handoffs: 1,
			harnessCalls: 1,
		});
	});
});
