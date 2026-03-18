import { describe, expect, it } from "bun:test";
import { z } from "zod";
import cancelAllWorkflowInstances from "../../src/server/modules/workflows/routes/cancel-all-workflow-instances.js";
import cancelWorkflowInstance from "../../src/server/modules/workflows/routes/cancel-workflow-instance.js";
import getWorkflowInstance from "../../src/server/modules/workflows/routes/get-workflow-instance.js";
import listWorkflowDefinitions from "../../src/server/modules/workflows/routes/list-workflow-definitions.js";
import listWorkflowInstances from "../../src/server/modules/workflows/routes/list-workflow-instances.js";
import retryAllWorkflowInstances from "../../src/server/modules/workflows/routes/retry-all-workflow-instances.js";
import retryWorkflowInstance from "../../src/server/modules/workflows/routes/retry-workflow-instance.js";
import sendWorkflowEvent from "../../src/server/modules/workflows/routes/send-workflow-event.js";
import triggerWorkflow from "../../src/server/modules/workflows/routes/trigger-workflow.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import { createFnContext, createMockStores } from "./helpers.js";

// ── Helpers ────────────────────────────────────────────────

const testWorkflow: WorkflowDefinition = {
	name: "test-wf",
	schema: z.object({ userId: z.string() }),
	timeout: "1h",
	handler: async () => {},
};

const cronWorkflow: WorkflowDefinition = {
	name: "cron-wf",
	schema: z.object({}),
	cron: "0 * * * *",
	cronOverlap: "skip",
	onFailure: async () => {},
	logLevel: "debug",
	retention: { completedAfter: "7d" },
	handler: async () => {},
};

const workflows = {
	"test-wf": testWorkflow,
	"cron-wf": cronWorkflow,
};

// ── Tests ──────────────────────────────────────────────────

describe("workflow routes", () => {
	describe("listWorkflowInstances", () => {
		it("returns paginated list of instances", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ limit: 50, page: 1 }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});
			stores.instances.set("inst-2", {
				id: "inst-2",
				name: "test-wf",
				status: "completed",
				createdAt: new Date(),
			});

			const result = await listWorkflowInstances.handler(ctx);
			expect(result.docs).toHaveLength(2);
			expect(result.page).toBe(1);
			expect(result.limit).toBe(50);
		});

		it("filters by status", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ status: "running", limit: 50, page: 1 },
				{ stores },
			);

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});
			stores.instances.set("inst-2", {
				id: "inst-2",
				name: "test-wf",
				status: "completed",
				createdAt: new Date(),
			});

			const result = await listWorkflowInstances.handler(ctx);
			expect(result.docs).toHaveLength(1);
			expect(result.docs[0].status).toBe("running");
		});

		it("filters by name", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ name: "test-wf", limit: 50, page: 1 },
				{ stores },
			);

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});
			stores.instances.set("inst-2", {
				id: "inst-2",
				name: "other-wf",
				status: "running",
				createdAt: new Date(),
			});

			const result = await listWorkflowInstances.handler(ctx);
			expect(result.docs).toHaveLength(1);
			expect(result.docs[0].name).toBe("test-wf");
		});
	});

	describe("getWorkflowInstance", () => {
		it("returns instance with steps", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ id: "inst-1", includeSteps: true, includeLogs: false },
				{ stores },
			);

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});

			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "greet",
				status: "completed",
				createdAt: new Date(),
			});

			const result = await getWorkflowInstance.handler(ctx);
			expect(result.instance.id).toBe("inst-1");
			expect(result.steps).toHaveLength(1);
			expect(result.logs).toHaveLength(0);
		});

		it("returns instance with logs", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ id: "inst-1", includeSteps: false, includeLogs: true },
				{ stores },
			);

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});

			stores.logs.set("log-1", {
				id: "log-1",
				instanceId: "inst-1",
				message: "test log",
				createdAt: new Date(),
			});

			const result = await getWorkflowInstance.handler(ctx);
			expect(result.steps).toHaveLength(0);
			expect(result.logs).toHaveLength(1);
		});

		it("throws for non-existent instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ id: "non-existent", includeSteps: true, includeLogs: false },
				{ stores },
			);

			await expect(getWorkflowInstance.handler(ctx)).rejects.toThrow(
				"Workflow instance not found",
			);
		});
	});

	describe("cancelWorkflowInstance", () => {
		it("cancels a running instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});

			const result = await cancelWorkflowInstance.handler(ctx);
			expect(result.success).toBe(true);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("cancelled");
			expect(instance.completedAt).toBeInstanceOf(Date);
		});

		it("cancels a pending instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "pending",
				createdAt: new Date(),
			});

			const result = await cancelWorkflowInstance.handler(ctx);
			expect(result.success).toBe(true);
		});

		it("cancels a suspended instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "suspended",
				createdAt: new Date(),
			});

			const result = await cancelWorkflowInstance.handler(ctx);
			expect(result.success).toBe(true);
		});

		it("returns failure for already completed instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "completed",
				createdAt: new Date(),
			});

			const result = await cancelWorkflowInstance.handler(ctx);
			expect(result.success).toBe(false);
			expect(result.reason).toContain("completed");
		});

		it("returns failure for failed instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "failed",
				createdAt: new Date(),
			});

			const result = await cancelWorkflowInstance.handler(ctx);
			expect(result.success).toBe(false);
		});

		it("throws for non-existent instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "non-existent" }, { stores });

			await expect(cancelWorkflowInstance.handler(ctx)).rejects.toThrow(
				"Workflow instance not found",
			);
		});
	});

	describe("retryWorkflowInstance", () => {
		it("retries a failed instance", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "failed",
				error: { message: "some error" },
				createdAt: new Date(),
			});

			const result = await retryWorkflowInstance.handler(ctx);
			expect(result.success).toBe(true);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("pending");
			expect(instance.error).toBeNull();
			expect(instance.completedAt).toBeNull();

			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
			expect(executeChannel.calls[0].payload).toEqual({
				instanceId: "inst-1",
				workflowName: "test-wf",
			});
		});

		it("retries a timed_out instance", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "timed_out",
				createdAt: new Date(),
			});

			const result = await retryWorkflowInstance.handler(ctx);
			expect(result.success).toBe(true);

			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
		});

		it("returns failure for running instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "inst-1" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});

			const result = await retryWorkflowInstance.handler(ctx);
			expect(result.success).toBe(false);
			expect(result.reason).toContain("running");
		});

		it("throws for non-existent instance", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ id: "non-existent" }, { stores });

			await expect(retryWorkflowInstance.handler(ctx)).rejects.toThrow(
				"Workflow instance not found",
			);
		});
	});

	describe("listWorkflowDefinitions", () => {
		it("returns all registered definitions with metadata", async () => {
			const { ctx } = createFnContext({}, { workflows });

			const result = await listWorkflowDefinitions.handler(ctx);
			expect(result.definitions).toHaveLength(2);

			const testDef = result.definitions.find((d: any) => d.name === "test-wf");
			expect(testDef).toBeDefined();
			expect(testDef?.timeout).toBe("1h");
			expect(testDef?.cron).toBeNull();
			expect(testDef?.hasOnFailure).toBe(false);

			const cronDef = result.definitions.find((d: any) => d.name === "cron-wf");
			expect(cronDef).toBeDefined();
			expect(cronDef?.cron).toBe("0 * * * *");
			expect(cronDef?.cronOverlap).toBe("skip");
			expect(cronDef?.hasOnFailure).toBe(true);
			expect(cronDef?.logLevel).toBe("debug");
			expect(cronDef?.retention).toEqual({ completedAfter: "7d" });
		});

		it("returns empty list when no workflows registered", async () => {
			const { ctx } = createFnContext({}, { workflows: {} });

			const result = await listWorkflowDefinitions.handler(ctx);
			expect(result.definitions).toHaveLength(0);
		});
	});

	describe("triggerWorkflow", () => {
		it("creates and queues a new workflow instance", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createFnContext(
				{ name: "test-wf", input: { userId: "alice" } },
				{ stores, workflows },
			);

			const result = await triggerWorkflow.handler(ctx);
			expect(result.existing).toBe(false);
			expect(result.instanceId).toBeDefined();

			// Instance should exist in store
			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(1);
			expect(instances[0].name).toBe("test-wf");
			expect(instances[0].status).toBe("pending");
			expect(instances[0].input).toEqual({ userId: "alice" });

			// Execute job should be queued
			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
		});

		it("validates input against workflow schema", async () => {
			const { ctx } = createFnContext(
				{ name: "test-wf", input: { userId: 123 } },
				{ workflows },
			);

			await expect(triggerWorkflow.handler(ctx)).rejects.toThrow();
		});

		it("returns existing instance for duplicate idempotency key", async () => {
			const stores = createMockStores();
			const { ctx: ctx1 } = createFnContext(
				{
					name: "test-wf",
					input: { userId: "alice" },
					idempotencyKey: "idem-1",
				},
				{ stores, workflows },
			);

			const result1 = await triggerWorkflow.handler(ctx1);
			expect(result1.existing).toBe(false);

			const { ctx: ctx2 } = createFnContext(
				{
					name: "test-wf",
					input: { userId: "alice" },
					idempotencyKey: "idem-1",
				},
				{ stores, workflows },
			);

			const result2 = await triggerWorkflow.handler(ctx2);
			expect(result2.existing).toBe(true);
			expect(result2.instanceId).toBe(result1.instanceId);
		});

		it("throws for unknown workflow", async () => {
			const { ctx } = createFnContext(
				{ name: "unknown-wf", input: {} },
				{ workflows },
			);

			await expect(triggerWorkflow.handler(ctx)).rejects.toThrow(
				'Unknown workflow: "unknown-wf"',
			);
		});

		it("sets timeoutAt from workflow definition", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ name: "test-wf", input: { userId: "alice" } },
				{ stores, workflows },
			);

			await triggerWorkflow.handler(ctx);

			const instances = Array.from(stores.instances.values());
			expect(instances[0].timeoutAt).toBeInstanceOf(Date);
			const diff = instances[0].timeoutAt.getTime() - Date.now();
			expect(diff).toBeGreaterThan(3500000); // ~58 min
			expect(diff).toBeLessThanOrEqual(3600000);
		});
	});

	describe("sendWorkflowEvent", () => {
		it("creates an event record", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ event: "user.created", data: { id: "u1" } },
				{ stores },
			);

			const result = await sendWorkflowEvent.handler(ctx);
			expect(result.matchedCount).toBe(0);

			// Event should be stored
			const events = Array.from(stores.events.values());
			expect(events).toHaveLength(1);
			expect(events[0].eventName).toBe("user.created");
			expect(events[0].sourceType).toBe("external");
		});

		it("resumes matching waiting steps", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createFnContext(
				{ event: "user.created", data: { id: "u1" } },
				{ stores },
			);

			// A waiting step for this event
			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "wait-user",
				type: "waitForEvent",
				status: "waiting",
				eventName: "user.created",
				matchCriteria: null,
				createdAt: new Date(),
			});

			const result = await sendWorkflowEvent.handler(ctx);
			expect(result.matchedCount).toBe(1);

			const resumeChannel = queue["questpie-wf-resume"];
			expect(resumeChannel.calls).toHaveLength(1);
			expect(resumeChannel.calls[0].payload.instanceId).toBe("inst-1");
			expect(resumeChannel.calls[0].payload.stepName).toBe("wait-user");
		});

		it("does not resume steps for different event names", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext(
				{ event: "order.placed", data: {} },
				{ stores },
			);

			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "wait-user",
				type: "waitForEvent",
				status: "waiting",
				eventName: "user.created",
				matchCriteria: null,
				createdAt: new Date(),
			});

			const result = await sendWorkflowEvent.handler(ctx);
			expect(result.matchedCount).toBe(0);
		});
	});

	describe("cancelAllWorkflowInstances", () => {
		it("cancels all active instances of a workflow", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ name: "test-wf" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});
			stores.instances.set("inst-2", {
				id: "inst-2",
				name: "test-wf",
				status: "suspended",
				createdAt: new Date(),
			});
			stores.instances.set("inst-3", {
				id: "inst-3",
				name: "test-wf",
				status: "completed",
				createdAt: new Date(),
			});

			const result = await cancelAllWorkflowInstances.handler(ctx);
			expect(result.cancelledCount).toBe(2);

			expect(stores.instances.get("inst-1").status).toBe("cancelled");
			expect(stores.instances.get("inst-2").status).toBe("cancelled");
			expect(stores.instances.get("inst-3").status).toBe("completed");
		});

		it("returns 0 when no active instances exist", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ name: "test-wf" }, { stores });

			const result = await cancelAllWorkflowInstances.handler(ctx);
			expect(result.cancelledCount).toBe(0);
		});
	});

	describe("retryAllWorkflowInstances", () => {
		it("retries all failed/timed_out instances", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createFnContext({ name: "test-wf" }, { stores });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "failed",
				createdAt: new Date(),
			});
			stores.instances.set("inst-2", {
				id: "inst-2",
				name: "test-wf",
				status: "timed_out",
				createdAt: new Date(),
			});
			stores.instances.set("inst-3", {
				id: "inst-3",
				name: "test-wf",
				status: "running",
				createdAt: new Date(),
			});

			const result = await retryAllWorkflowInstances.handler(ctx);
			expect(result.retriedCount).toBe(2);

			expect(stores.instances.get("inst-1").status).toBe("pending");
			expect(stores.instances.get("inst-2").status).toBe("pending");
			expect(stores.instances.get("inst-3").status).toBe("running");

			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(2);
		});

		it("returns 0 when no failed instances exist", async () => {
			const stores = createMockStores();
			const { ctx } = createFnContext({ name: "test-wf" }, { stores });

			const result = await retryAllWorkflowInstances.handler(ctx);
			expect(result.retriedCount).toBe(0);
		});
	});
});
