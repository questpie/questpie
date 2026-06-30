/**
 * T5: finalizeRun — the ONE terminal path with the exactly-once latch.
 *
 * The mock run_links collection honors `id` + `finalizedAt:null` +
 * `status:{notIn:[…]}` (the RAW jsonb-epoch predicate is a no-op at unit level,
 * like the T4 harness-run-stream mock — the epoch fence is integration-proven).
 * That is sufficient to prove exactly-once: once a finalizer wins (sets
 * finalizedAt + a terminal status), every later finalizer's update returns [].
 */

import { describe, expect, it } from "bun:test";

import { finalizeRun, type FinalizeRunDeps } from "../finalize-run.js";

interface Captures {
	row: Record<string, unknown>;
	events: Array<{ event: string; data: any; match: any }>;
	created: Array<Record<string, unknown>>;
	finished: string[];
	knowledge: Array<{ runId: string; summary?: string; source?: string }>;
}

function makeDeps(initial: Record<string, unknown>): {
	deps: FinalizeRunDeps;
	cap: Captures;
} {
	const cap: Captures = {
		row: { finalizedAt: null, ...initial },
		events: [],
		created: [],
		finished: [],
		knowledge: [],
	};
	const deps: FinalizeRunDeps = {
		collections: {
			run_links: {
				async update({ where, data }: { where: any; data: any }) {
					if (where.id !== cap.row.id) return [];
					if (where.finalizedAt === null && cap.row.finalizedAt != null) {
						return [];
					}
					const notIn = where.status?.notIn;
					if (Array.isArray(notIn) && notIn.includes(cap.row.status)) {
						return [];
					}
					Object.assign(cap.row, data);
					return [{ ...cap.row }];
				},
			},
			chat_messages: {
				async create(data: Record<string, unknown>) {
					cap.created.push(data);
					return { id: "msg1" };
				},
			},
		},
		streamStore: {
			async finish(streamId: string) {
				cap.finished.push(streamId);
			},
		},
		workflows: {
			sendEvent(event: string, data: any, match: any) {
				cap.events.push({ event, data, match });
			},
		},
		knowledgeResource: {
			async createRunOutputs(input) {
				cap.knowledge.push(input);
				return [{ id: "kr1" }];
			},
		},
	};
	return { deps, cap };
}

describe("finalizeRun (T5)", () => {
	it("task success: latch won → terminal + seal + knowledge + exactly one run.completed", async () => {
		const { deps, cap } = makeDeps({
			id: "r1",
			status: "running",
			activeStreamId: "run-stream:s1",
			chatSession: null,
		});

		const res = await finalizeRun(deps, {
			runId: "r1",
			kind: "task",
			terminal: "completed",
			epoch: 1,
			summary: "done",
			tokensInput: 3,
			tokensOutput: 5,
		});

		expect(res.finalized).toBe(true);
		expect(cap.row.status).toBe("completed");
		expect(cap.row.finalizedAt).not.toBeNull();
		expect(cap.row.tokensInput).toBe(3);
		expect(cap.finished).toEqual(["run-stream:s1"]);
		expect(cap.knowledge).toHaveLength(1);
		expect(cap.events).toHaveLength(1);
		expect(cap.events[0].event).toBe("run.completed");
		expect(cap.events[0].data.status).toBe("completed");
		expect(cap.events[0].data.knowledgeResourceIds).toEqual(["kr1"]);
		expect(cap.events[0].match).toEqual({ runId: "r1" });
	});

	it("chat success: assistant chat_messages row written WITH run (B6)", async () => {
		const { deps, cap } = makeDeps({
			id: "r2",
			status: "running",
			activeStreamId: "run-stream:s2",
			chatSession: "cs1",
		});

		await finalizeRun(deps, {
			runId: "r2",
			kind: "chat",
			terminal: "completed",
			epoch: 1,
			summary: "hi",
			messageId: "m1",
			uiMessages: [{ type: "start", messageId: "m1" }],
		});

		expect(cap.created).toHaveLength(1);
		expect(cap.created[0].run).toBe("r2");
		expect(cap.created[0].chatSession).toBe("cs1");
		expect(cap.created[0].uiMessageId).toBe("m1");
		expect(cap.created[0].role).toBe("assistant");
		expect(cap.created[0].runStatus).toBe("completed");
	});

	it("exactly-once (B4): reaper-failure wins, zombie-success no-ops → ONE terminal + ONE run.completed", async () => {
		const { deps, cap } = makeDeps({
			id: "r3",
			status: "running",
			activeStreamId: "run-stream:s3",
			chatSession: null,
		});

		// Reaper wins the latch (sets finalizedAt + status=failed).
		const reaper = await finalizeRun(deps, {
			runId: "r3",
			kind: "task",
			terminal: "failed",
			epoch: 2,
			error: "worker lease expired",
		});
		expect(reaper.finalized).toBe(true);
		expect(cap.row.status).toBe("failed");

		// Zombie worker tries to finalize success — latch lost (finalizedAt set,
		// status terminal). No terminal write, no second event.
		const zombie = await finalizeRun(deps, {
			runId: "r3",
			kind: "task",
			terminal: "completed",
			epoch: 1,
			summary: "done",
		});
		expect(zombie.finalized).toBe(false);
		expect(cap.row.status).toBe("failed"); // unchanged

		expect(
			cap.events.filter((event) => event.event === "run.completed"),
		).toHaveLength(1);
		expect(cap.events[0].data.status).toBe("failed");
	});

	it("cancel-safe (B5): finalize after /cancel (status=cancelled) → latch lost, NO assistant row (no resurrection)", async () => {
		const { deps, cap } = makeDeps({
			id: "r4",
			status: "cancelled",
			activeStreamId: "run-stream:s4",
			chatSession: "cs4",
		});

		const res = await finalizeRun(deps, {
			runId: "r4",
			kind: "chat",
			terminal: "completed",
			epoch: 1,
			summary: "late completion",
			messageId: "m4",
		});

		expect(res.finalized).toBe(false);
		expect(cap.created).toHaveLength(0); // no resurrected assistant message
		expect(cap.events).toHaveLength(0);
		expect(cap.row.status).toBe("cancelled");
	});
});
