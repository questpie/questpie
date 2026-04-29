import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { wfExecuteJob } from "../../src/server/modules/workflows/jobs/wf-execute.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import { createJobContext, createMockStores } from "./helpers.js";

const handler = wfExecuteJob.handler;

// ── Test workflow definitions ──────────────────────────────

const simpleWorkflow: WorkflowDefinition = {
	name: "simple-wf",
	schema: z.object({ userId: z.string() }),
	handler: async ({ input, step }) => {
		const greeting = await step.run("greet", async () => {
			return `Hello ${(input as any).userId}`;
		});
		return { greeting };
	},
};

const failingWorkflow: WorkflowDefinition = {
	name: "failing-wf",
	schema: z.object({}),
	handler: async ({ step }) => {
		await step.run("boom", async () => {
			throw new Error("Step exploded");
		});
	},
};

const sleepWorkflow: WorkflowDefinition = {
	name: "sleep-wf",
	schema: z.object({}),
	handler: async ({ step }) => {
		await step.sleep("nap", "10m");
		return { done: true };
	},
};

const onFailureWorkflow: WorkflowDefinition = {
	name: "onfailure-wf",
	schema: z.object({}),
	onFailure: async ({ error, log }) => {
		log.info(`Handled failure: ${error.message}`);
	},
	handler: async ({ step }) => {
		await step.run("fail-step", async () => {
			throw new Error("Expected failure");
		});
	},
};

// ── Tests ──────────────────────────────────────────────────

describe("wf-execute job", () => {
	it("throws when workflow definition is not found", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "unknown-wf" },
			{ stores, workflows: {} },
		);

		await expect(handler(ctx)).rejects.toThrow(
			'Workflow definition not found: "unknown-wf"',
		);
	});

	it("throws when collections are missing", async () => {
		const ctx: any = {
			payload: { instanceId: "inst-1", workflowName: "test-wf" },
			app: { state: { workflows: { "test-wf": simpleWorkflow } } },
			collections: {},
			queue: {},
			logger: {},
		};

		await expect(handler(ctx)).rejects.toThrow(
			"Workflow system collections not found",
		);
	});

	it("executes a simple workflow to completion", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "simple-wf" },
			{ stores, workflows: { "simple-wf": simpleWorkflow } },
		);

		// Pre-populate instance
		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "simple-wf",
			status: "pending",
			input: { userId: "alice" },
			attempt: 0,
			createdAt: new Date(),
		});

		await handler(ctx);

		// Instance should be completed
		const instance = stores.instances.get("inst-1");
		expect(instance.status).toBe("completed");
		expect(instance.output).toEqual({ greeting: "Hello alice" });
		expect(instance.completedAt).toBeInstanceOf(Date);
		expect(instance.attempt).toBe(1);

		// Step should be recorded
		const steps = Array.from(stores.steps.values());
		expect(steps).toHaveLength(1);
		expect(steps[0].name).toBe("greet");
		expect(steps[0].status).toBe("completed");
		expect(steps[0].result).toBe("Hello alice");

		// Logs should have been flushed
		const logs = Array.from(stores.logs.values());
		expect(logs.length).toBeGreaterThan(0);
	});

	it("handles a workflow that fails", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "failing-wf" },
			{ stores, workflows: { "failing-wf": failingWorkflow } },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "failing-wf",
			status: "pending",
			input: {},
			attempt: 0,
			createdAt: new Date(),
		});

		await handler(ctx);

		const instance = stores.instances.get("inst-1");
		expect(instance.status).toBe("failed");
		expect(instance.error).toBeDefined();
		expect(instance.error.message).toContain("Step exploded");
		expect(instance.completedAt).toBeInstanceOf(Date);
	});

	it("suspends workflow on sleep step", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "sleep-wf" },
			{ stores, workflows: { "sleep-wf": sleepWorkflow } },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "sleep-wf",
			status: "pending",
			input: {},
			attempt: 0,
			createdAt: new Date(),
		});

		await handler(ctx);

		const instance = stores.instances.get("inst-1");
		expect(instance.status).toBe("suspended");
		expect(instance.suspendedAt).toBeInstanceOf(Date);

		// A sleeping step should be recorded
		const steps = Array.from(stores.steps.values());
		expect(steps.length).toBeGreaterThan(0);
		const sleepStep = steps.find((s: any) => s.name === "nap");
		expect(sleepStep).toBeDefined();
		expect(sleepStep.type).toBe("sleep");
		expect(sleepStep.status).toBe("sleeping");
	});

	it("runs onFailure handler when defined", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "onfailure-wf" },
			{ stores, workflows: { "onfailure-wf": onFailureWorkflow } },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "onfailure-wf",
			status: "pending",
			input: {},
			attempt: 0,
			createdAt: new Date(),
		});

		await handler(ctx);

		const instance = stores.instances.get("inst-1");
		expect(instance.status).toBe("failed");

		// Logs should contain the onFailure handler message
		const logs = Array.from(stores.logs.values());
		const onFailureLog = logs.find(
			(l: any) =>
				typeof l.message === "string" && l.message.includes("Handled failure"),
		);
		expect(onFailureLog).toBeDefined();
	});

	it("resumes parent workflow when child completes", async () => {
		const stores = createMockStores();
		const { ctx, queue } = createJobContext(
			{ instanceId: "child-1", workflowName: "simple-wf" },
			{ stores, workflows: { "simple-wf": simpleWorkflow } },
		);

		// Child instance with parent reference
		stores.instances.set("child-1", {
			id: "child-1",
			name: "simple-wf",
			status: "pending",
			input: { userId: "child-user" },
			attempt: 0,
			parentInstanceId: "parent-1",
			parentStepName: "invoke-child",
			createdAt: new Date(),
		});

		await handler(ctx);

		// Check resume was published for parent
		const resumeChannel = queue["questpie-wf-resume"];
		expect(resumeChannel.calls).toHaveLength(1);
		expect(resumeChannel.calls[0].payload).toEqual({
			instanceId: "parent-1",
			stepName: "invoke-child",
			result: { greeting: "Hello child-user" },
		});
	});

	it("propagates failure to parent when child fails", async () => {
		const stores = createMockStores();
		const { ctx, queue } = createJobContext(
			{ instanceId: "child-1", workflowName: "failing-wf" },
			{ stores, workflows: { "failing-wf": failingWorkflow } },
		);

		// Child instance with parent reference
		stores.instances.set("child-1", {
			id: "child-1",
			name: "failing-wf",
			status: "pending",
			input: {},
			attempt: 0,
			parentInstanceId: "parent-1",
			parentStepName: "invoke-child",
			createdAt: new Date(),
		});

		// Parent instance and its invoke step (waiting for child)
		stores.instances.set("parent-1", {
			id: "parent-1",
			name: "parent-wf",
			status: "suspended",
			input: {},
			attempt: 1,
			createdAt: new Date(),
		});

		stores.steps.set("parent-step-1", {
			id: "parent-step-1",
			instanceId: "parent-1",
			name: "invoke-child",
			type: "invoke",
			status: "waiting",
			createdAt: new Date(),
		});

		await handler(ctx);

		// Parent step should be marked failed
		const parentStep = stores.steps.get("parent-step-1");
		expect(parentStep.status).toBe("failed");
		expect(parentStep.error.message).toContain("Child workflow");

		// Execute should be re-queued for parent
		const executeChannel = queue["questpie-wf-execute"];
		expect(executeChannel.calls).toHaveLength(1);
		expect(executeChannel.calls[0].payload.instanceId).toBe("parent-1");
	});

	it("replays completed steps from cache on re-execution", async () => {
		const stores = createMockStores();

		// A workflow with 2 steps where first already completed
		const twoStepWf: WorkflowDefinition = {
			name: "two-step",
			schema: z.object({}),
			handler: async ({ step }) => {
				const a = await step.run("step-a", async () => "result-a");
				const b = await step.run("step-b", async () => "result-b");
				return { a, b };
			},
		};

		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "two-step" },
			{ stores, workflows: { "two-step": twoStepWf } },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "two-step",
			status: "suspended",
			input: {},
			attempt: 1,
			createdAt: new Date(),
		});

		// Step-a is already completed from a previous run
		stores.steps.set("cached-step-a", {
			id: "cached-step-a",
			instanceId: "inst-1",
			name: "step-a",
			type: "run",
			status: "completed",
			result: "result-a",
			error: null,
			attempt: 1,
			hasCompensation: false,
			scheduledAt: null,
			createdAt: new Date(),
		});

		await handler(ctx);

		const instance = stores.instances.get("inst-1");
		expect(instance.status).toBe("completed");
		expect(instance.output).toEqual({ a: "result-a", b: "result-b" });

		// step-b should now also exist in the store
		const allSteps = Array.from(stores.steps.values()).filter(
			(s: any) => s.instanceId === "inst-1",
		);
		expect(allSteps.length).toBe(2);
	});

	it("throws when instance is not found", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "non-existent", workflowName: "simple-wf" },
			{ stores, workflows: { "simple-wf": simpleWorkflow } },
		);

		// Don't populate instance
		await expect(handler(ctx)).rejects.toThrow(
			"Workflow instance not found: non-existent",
		);
	});

	it("flushes logs even on failure", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{ instanceId: "inst-1", workflowName: "failing-wf" },
			{ stores, workflows: { "failing-wf": failingWorkflow } },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "failing-wf",
			status: "pending",
			input: {},
			attempt: 0,
			createdAt: new Date(),
		});

		await handler(ctx);

		// Should have logs from the failed execution
		const logs = Array.from(stores.logs.values());
		expect(logs.length).toBeGreaterThan(0);

		// Should include the failure log
		const failLog = logs.find(
			(l: any) => typeof l.message === "string" && l.message.includes("failed"),
		);
		expect(failLog).toBeDefined();
	});
});
