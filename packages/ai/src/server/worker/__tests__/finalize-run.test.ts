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

import {
	type FinalizeRunDeps,
	finalizeRun,
	MAX_LOG_ARTIFACT_BYTES,
} from "../finalize-run.js";

interface KnowledgeArtifact {
	title?: string | null;
	path?: string | null;
	kind?: string | null;
	body?: string | null;
	contentType?: string | null;
}

interface Captures {
	row: Record<string, unknown>;
	events: Array<{ event: string; data: any; match: any }>;
	created: Array<Record<string, unknown>>;
	finished: string[];
	appended: Array<{ streamId: string; data: string }>;
	knowledge: Array<{
		runId: string;
		summary?: string;
		source?: string;
		artifacts?: KnowledgeArtifact[];
	}>;
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
		appended: [],
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
			async append(streamId: string, data: string) {
				cap.appended.push({ streamId, data });
			},
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
		// T8: the failed path appends a real error UIMessage chunk + finish before
		// sealing (the reaper's error wire, §3.6) — no-op if already sealed.
		expect(cap.appended.map((entry) => entry.data)).toEqual([
			'{"type":"error","errorText":"worker lease expired"}',
			'{"type":"finish"}',
		]);

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

	it("OQ6: completed task WITH uiMessages → ONE merged createRunOutputs call (summary + exactly one kind='log' transcript artifact)", async () => {
		const { deps, cap } = makeDeps({
			id: "r5",
			status: "running",
			activeStreamId: "run-stream:s5",
			chatSession: null,
		});
		const uiMessages = [{ type: "start", messageId: "m5" }, { type: "finish" }];

		const res = await finalizeRun(deps, {
			runId: "r5",
			kind: "task",
			terminal: "completed",
			epoch: 1,
			summary: "done",
			uiMessages,
		});

		expect(res.finalized).toBe(true);
		// MERGED: one invocation carrying summary + the log artifact, so the
		// service's runs/{id}/summary.md semantics are preserved.
		expect(cap.knowledge).toHaveLength(1);
		expect(cap.knowledge[0].summary).toBe("done");
		const artifacts = cap.knowledge[0].artifacts ?? [];
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0].kind).toBe("log");
		expect(artifacts[0].path).toBe("runs/r5/transcript.json");
		expect(artifacts[0].title).toBe("Run transcript");
		expect(artifacts[0].contentType).toBe("application/json");
		expect(artifacts[0].body).toBe(JSON.stringify(uiMessages));
	});

	it("OQ6: completed non-task (chat) WITH uiMessages → standalone sink call with exactly one kind='log' artifact", async () => {
		const { deps, cap } = makeDeps({
			id: "r6",
			status: "running",
			activeStreamId: "run-stream:s6",
			chatSession: "cs6",
		});

		await finalizeRun(deps, {
			runId: "r6",
			kind: "chat",
			terminal: "completed",
			epoch: 1,
			summary: "hi",
			messageId: "m6",
			uiMessages: [{ type: "start", messageId: "m6" }],
		});

		expect(cap.knowledge).toHaveLength(1);
		expect(cap.knowledge[0].summary).toBeUndefined(); // no summary.md for non-task kinds
		const artifacts = cap.knowledge[0].artifacts ?? [];
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0].kind).toBe("log");
		expect(artifacts[0].path).toBe("runs/r6/transcript.json");
	});

	it("OQ6: latch lost → no sink call (no transcript artifact)", async () => {
		const { deps, cap } = makeDeps({
			id: "r7",
			status: "cancelled",
			activeStreamId: "run-stream:s7",
			chatSession: null,
		});

		const res = await finalizeRun(deps, {
			runId: "r7",
			kind: "task",
			terminal: "completed",
			epoch: 1,
			summary: "late",
			uiMessages: [{ type: "start", messageId: "m7" }],
		});

		expect(res.finalized).toBe(false);
		expect(cap.knowledge).toHaveLength(0);
	});

	for (const kind of ["task", "chat"] as const) {
		it(`OQ6: throwing knowledge sink still finalizes (${kind}: terminal write + run.completed)`, async () => {
			const { deps, cap } = makeDeps({
				id: "r8",
				status: "running",
				activeStreamId: "run-stream:s8",
				chatSession: kind === "chat" ? "cs8" : null,
			});
			deps.knowledgeResource = {
				async createRunOutputs() {
					throw new Error("sink down");
				},
			};

			const res = await finalizeRun(deps, {
				runId: "r8",
				kind,
				terminal: "completed",
				epoch: 1,
				summary: "done",
				uiMessages: [{ type: "start", messageId: "m8" }],
			});

			expect(res.finalized).toBe(true);
			expect(cap.row.status).toBe("completed"); // terminal write happened
			expect(cap.row.finalizedAt).not.toBeNull();
			expect(cap.events).toHaveLength(1); // run.completed still fired
			expect(cap.events[0].event).toBe("run.completed");
		});
	}

	it("OQ6: transcript over MAX_LOG_ARTIFACT_BYTES → oldest messages dropped, {truncated:true} recorded, body under the cap", async () => {
		const { deps, cap } = makeDeps({
			id: "r9",
			status: "running",
			activeStreamId: "run-stream:s9",
			chatSession: null,
		});
		// 5 × ~100KiB messages ≈ 500KiB serialized — only the newest two fit.
		const uiMessages = Array.from({ length: 5 }, (_, i) => ({
			id: i,
			blob: "x".repeat(100 * 1024),
		}));

		await finalizeRun(deps, {
			runId: "r9",
			kind: "task",
			terminal: "completed",
			epoch: 1,
			summary: "done",
			uiMessages,
		});

		const body = cap.knowledge[0]?.artifacts?.[0]?.body ?? "";
		expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(
			MAX_LOG_ARTIFACT_BYTES,
		);
		const parsed = JSON.parse(body);
		expect(parsed.truncated).toBe(true);
		// Oldest dropped first: only the newest messages remain, in order.
		expect(parsed.messages.map((m: { id: number }) => m.id)).toEqual([3, 4]);
	});
});
