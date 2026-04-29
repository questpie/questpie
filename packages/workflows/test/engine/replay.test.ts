import { describe, expect, mock, test } from "bun:test";
import { z } from "zod";
import type { EngineContext } from "../../src/server/engine/engine.js";
import { executeWorkflowHandler } from "../../src/server/engine/engine.js";
import { NonDeterministicError } from "../../src/server/engine/errors.js";
import type {
	CachedStep,
	StepPersistence,
} from "../../src/server/engine/step-context.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";

// ── Helpers ─────────────────────────────────────────────────

function createMockEngineContext(options?: {
	instance?: {
		id: string;
		name: string;
		status: string;
		input: unknown;
		attempt: number;
	};
	steps?: CachedStep[];
}): {
	engineCtx: EngineContext;
	updates: Array<{ instanceId: string; update: Record<string, unknown> }>;
	createdSteps: Array<Record<string, unknown>>;
	updatedSteps: Array<{
		instanceId: string;
		name: string;
		update: Record<string, unknown>;
	}>;
	flushedLogs: Array<{ instanceId: string; count: number }>;
} {
	const updates: Array<{
		instanceId: string;
		update: Record<string, unknown>;
	}> = [];
	const createdSteps: Array<Record<string, unknown>> = [];
	const updatedSteps: Array<{
		instanceId: string;
		name: string;
		update: Record<string, unknown>;
	}> = [];
	const flushedLogs: Array<{ instanceId: string; count: number }> = [];
	let stepId = 0;

	const persistence: StepPersistence = {
		async createStep(step) {
			createdSteps.push(step as Record<string, unknown>);
			return { id: `step-${++stepId}` };
		},
		async updateStep(instanceId, name, update) {
			updatedSteps.push({
				instanceId,
				name,
				update: update as Record<string, unknown>,
			});
		},
	};

	const instance = options?.instance ?? {
		id: "inst-1",
		name: "test-workflow",
		status: "pending",
		input: { value: 42 },
		attempt: 0,
	};

	const engineCtx: EngineContext = {
		async loadInstance(instanceId) {
			return instanceId === instance.id ? instance : null;
		},
		async loadSteps() {
			return options?.steps ?? [];
		},
		persistence,
		async updateInstance(instanceId, update) {
			updates.push({ instanceId, update: update as Record<string, unknown> });
		},
		async flushLogs(instanceId, entries) {
			flushedLogs.push({ instanceId, count: entries.length });
		},
		appContext: { db: "mock-db" },
	};

	return { engineCtx, updates, createdSteps, updatedSteps, flushedLogs };
}

// ── Tests ───────────────────────────────────────────────────

describe("executeWorkflowHandler", () => {
	describe("fresh execution (no cached steps)", () => {
		test("runs handler and completes successfully", async () => {
			const definition: WorkflowDefinition = {
				name: "simple",
				schema: z.object({ value: z.number() }),
				handler: async ({ input, step }) => {
					const a = await step.run(
						"step-a",
						async () => (input as any).value * 2,
					);
					const b = await step.run("step-b", async () => a + 10);
					return { result: b };
				},
			};

			const { engineCtx, updates, createdSteps } = createMockEngineContext();
			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("completed");
			if (result.status === "completed") {
				expect(result.output).toEqual({ result: 94 });
			}

			// Instance should be set to running then completed
			expect(updates).toHaveLength(2);
			expect(updates[0].update.status).toBe("running");
			expect(updates[1].update.status).toBe("completed");
			expect(updates[1].update.output).toEqual({ result: 94 });

			// Two steps created
			expect(createdSteps).toHaveLength(2);
		});

		test("handler has access to ctx", async () => {
			const definition: WorkflowDefinition = {
				name: "ctx-test",
				schema: z.object({}),
				handler: async ({ ctx }) => {
					return { db: ctx.db };
				},
			};

			const { engineCtx } = createMockEngineContext();
			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("completed");
			if (result.status === "completed") {
				expect(result.output).toEqual({ db: "mock-db" });
			}
		});
	});

	describe("suspension (sleep)", () => {
		test("suspends on step.sleep()", async () => {
			const definition: WorkflowDefinition = {
				name: "sleepy",
				schema: z.object({}),
				handler: async ({ step }) => {
					await step.run("step-a", async () => "done");
					await step.sleep("wait-5m", "5m");
					// This line should not be reached
					return "completed";
				},
			};

			const { engineCtx, updates, createdSteps } = createMockEngineContext();
			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("suspended");
			if (result.status === "suspended") {
				expect(result.stepName).toBe("wait-5m");
				expect(result.resumeAt).toBeDefined();
			}

			// Instance: running → suspended
			expect(updates).toHaveLength(2);
			expect(updates[0].update.status).toBe("running");
			expect(updates[1].update.status).toBe("suspended");

			// step-a (completed) + wait-5m (sleeping)
			expect(createdSteps).toHaveLength(2);
		});
	});

	describe("replay (cached steps)", () => {
		test("replays cached step.run() and continues", async () => {
			const stepAFn = mock(async () => "should not run");
			const definition: WorkflowDefinition = {
				name: "replay",
				schema: z.object({}),
				handler: async ({ step }) => {
					const a = await step.run("step-a", stepAFn);
					const b = await step.run("step-b", async () => `${a}-new`);
					return { result: b };
				},
			};

			const { engineCtx, createdSteps } = createMockEngineContext({
				steps: [
					{
						name: "step-a",
						type: "run",
						status: "completed",
						result: "cached-value",
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: false,
					},
				],
			});

			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("completed");
			if (result.status === "completed") {
				expect(result.output).toEqual({ result: "cached-value-new" });
			}

			// step-a was cached (not re-executed)
			expect(stepAFn).not.toHaveBeenCalled();

			// Only step-b was created new
			expect(createdSteps).toHaveLength(1);
			expect(createdSteps[0].name).toBe("step-b");
		});

		test("replays sleep step that was resumed", async () => {
			const definition: WorkflowDefinition = {
				name: "resumed-sleep",
				schema: z.object({}),
				handler: async ({ step }) => {
					await step.run("step-a", async () => "done");
					await step.sleep("wait-5m", "5m");
					const b = await step.run("step-b", async () => "after-sleep");
					return { result: b };
				},
			};

			const { engineCtx, createdSteps } = createMockEngineContext({
				steps: [
					{
						name: "step-a",
						type: "run",
						status: "completed",
						result: "done",
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: false,
					},
					{
						name: "wait-5m",
						type: "sleep",
						status: "completed",
						result: null,
						error: null,
						attempt: 1,
						scheduledAt: new Date("2026-01-01T00:05:00Z"),
						hasCompensation: false,
					},
				],
			});

			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("completed");
			if (result.status === "completed") {
				expect(result.output).toEqual({ result: "after-sleep" });
			}

			// Only step-b is new
			expect(createdSteps).toHaveLength(1);
			expect(createdSteps[0].name).toBe("step-b");
		});
	});

	describe("failure handling", () => {
		test("marks instance as failed on handler error", async () => {
			const definition: WorkflowDefinition = {
				name: "failing",
				schema: z.object({}),
				handler: async ({ step }) => {
					await step.run("step-a", async () => {
						throw new Error("something broke");
					});
				},
			};

			const { engineCtx, updates } = createMockEngineContext();
			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.error.message).toBe("something broke");
			}

			// Instance: running → failed
			expect(updates).toHaveLength(2);
			expect(updates[1].update.status).toBe("failed");
		});
	});

	describe("non-determinism detection", () => {
		test("throws NonDeterministicError on step order mismatch", async () => {
			const definition: WorkflowDefinition = {
				name: "non-det",
				schema: z.object({}),
				handler: async ({ step }) => {
					// Code was modified — step-b now runs before step-a
					await step.run("step-b", async () => "b");
					await step.run("step-a", async () => "a");
				},
			};

			const { engineCtx } = createMockEngineContext({
				// Previous execution order was: step-a, step-b
				steps: [
					{
						name: "step-a",
						type: "run",
						status: "completed",
						result: "a",
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: false,
					},
					{
						name: "step-b",
						type: "run",
						status: "completed",
						result: "b",
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: false,
					},
				],
			});

			const result = await executeWorkflowHandler(
				definition,
				"inst-1",
				engineCtx,
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.error).toBeInstanceOf(NonDeterministicError);
			}
		});
	});

	describe("log flushing", () => {
		test("flushes logs after completion", async () => {
			const definition: WorkflowDefinition = {
				name: "logged",
				schema: z.object({}),
				handler: async ({ log }) => {
					log.info("started");
					log.info("done");
					return "ok";
				},
			};

			const { engineCtx, flushedLogs } = createMockEngineContext();
			await executeWorkflowHandler(definition, "inst-1", engineCtx);

			expect(flushedLogs).toHaveLength(1);
			// info("started") + info("done") + internal "execution started" + "completed"
			expect(flushedLogs[0].count).toBeGreaterThanOrEqual(2);
		});

		test("flushes logs even on failure", async () => {
			const definition: WorkflowDefinition = {
				name: "fail-logged",
				schema: z.object({}),
				handler: async () => {
					throw new Error("boom");
				},
			};

			const { engineCtx, flushedLogs } = createMockEngineContext();
			await executeWorkflowHandler(definition, "inst-1", engineCtx);

			expect(flushedLogs).toHaveLength(1);
		});
	});

	describe("instance not found", () => {
		test("throws on missing instance", async () => {
			const definition: WorkflowDefinition = {
				name: "missing",
				schema: z.object({}),
				handler: async () => "ok",
			};

			const { engineCtx } = createMockEngineContext();
			await expect(
				executeWorkflowHandler(definition, "non-existent", engineCtx),
			).rejects.toThrow("Workflow instance not found");
		});
	});
});
