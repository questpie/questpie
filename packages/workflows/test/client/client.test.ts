import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
	type CollectionCrud,
	createWorkflowClient,
	type QueuePublish,
	type WorkflowClientDeps,
} from "../../src/server/client.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";

// ── Mock helpers ────────────────────────────────────────────

function createMockCrud(store: Map<string, any> = new Map()): CollectionCrud {
	let idCounter = 0;
	return {
		async create(input: any, _context?: any) {
			const id = `id-${++idCounter}`;
			const record = { id, ...input, createdAt: new Date() };
			store.set(id, record);
			return record;
		},
		async findOne(options?: any, _context?: any) {
			const where = options?.where ?? {};
			for (const [, record] of store) {
				let match = true;
				for (const [key, value] of Object.entries(where)) {
					if (record[key] !== value) {
						match = false;
						break;
					}
				}
				if (match) return record;
			}
			return null;
		},
		async find(options?: any, _context?: any) {
			const where = options?.where ?? {};
			const docs: any[] = [];
			for (const [, record] of store) {
				let match = true;
				for (const [key, value] of Object.entries(where)) {
					if (record[key] !== value) {
						match = false;
						break;
					}
				}
				if (match) docs.push(record);
			}
			return { docs };
		},
		async updateById(params: any, _context?: any) {
			const record = store.get(params.id);
			if (!record) throw new Error(`Not found: ${params.id}`);
			Object.assign(record, params.data);
			return record;
		},
	};
}

function createMockQueue(): QueuePublish & { calls: any[] } {
	const calls: any[] = [];
	return {
		calls,
		async publish(payload: any, options?: any) {
			calls.push({ payload, options });
			return { id: `job-${calls.length}` };
		},
	};
}

function createDeps(
	overrides?: Partial<WorkflowClientDeps> & { publishResume?: QueuePublish },
) {
	const instanceStore = new Map<string, any>();
	const stepStore = new Map<string, any>();
	const eventStore = new Map<string, any>();
	const queue = createMockQueue();

	return {
		deps: {
			instances: overrides?.instances ?? createMockCrud(instanceStore),
			steps: overrides?.steps ?? createMockCrud(stepStore),
			events: overrides?.events ?? createMockCrud(eventStore),
			publishExecute: overrides?.publishExecute ?? queue,
			publishResume: overrides?.publishResume,
		},
		instanceStore,
		stepStore,
		eventStore,
		queue,
	};
}

const testWorkflow: WorkflowDefinition<{ userId: string }, void, "test-wf"> = {
	name: "test-wf",
	schema: z.object({ userId: z.string() }),
	handler: async () => {},
};

const timedWorkflow: WorkflowDefinition<{ taskId: string }, void, "timed-wf"> =
	{
		name: "timed-wf",
		schema: z.object({ taskId: z.string() }),
		timeout: "1h",
		handler: async () => {},
	};

// ── Tests ───────────────────────────────────────────────────

describe("createWorkflowClient", () => {
	describe("trigger()", () => {
		it("creates an instance and publishes execute job", async () => {
			const { deps, queue } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const result = await client.trigger("test-wf", { userId: "u1" });

			expect(result.existing).toBe(false);
			expect(result.instanceId).toMatch(/^id-/);
			expect(queue.calls).toHaveLength(1);
			expect(queue.calls[0].payload).toEqual({
				instanceId: result.instanceId,
				workflowName: "test-wf",
			});
		});

		it("validates input against schema", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			await expect(
				client.trigger("test-wf", { userId: 123 } as any),
			).rejects.toThrow();
		});

		it("throws for unknown workflow", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			await expect((client as any).trigger("non-existent", {})).rejects.toThrow(
				'Unknown workflow: "non-existent"',
			);
		});

		it("returns existing instance on idempotency key match", async () => {
			const { deps, queue } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const first = await client.trigger(
				"test-wf",
				{ userId: "u1" },
				{
					idempotencyKey: "idem-1",
				},
			);
			expect(first.existing).toBe(false);

			const second = await client.trigger(
				"test-wf",
				{ userId: "u1" },
				{
					idempotencyKey: "idem-1",
				},
			);
			expect(second.existing).toBe(true);
			expect(second.instanceId).toBe(first.instanceId);

			// Only one job should have been published
			expect(queue.calls).toHaveLength(1);
		});

		it("sets timeoutAt from workflow definition", async () => {
			const instanceStore = new Map<string, any>();
			const { deps } = createDeps({
				instances: createMockCrud(instanceStore),
			});
			const client = createWorkflowClient({ "timed-wf": timedWorkflow }, deps);

			const result = await client.trigger("timed-wf", { taskId: "t1" });
			const instance = instanceStore.values().next().value;

			expect(instance).toBeDefined();
			expect(instance.timeoutAt).toBeInstanceOf(Date);
			// timeout is 1h = 3600000ms; should be roughly 1h from now
			const diff = instance.timeoutAt.getTime() - Date.now();
			expect(diff).toBeGreaterThan(3500000); // at least ~58 min
			expect(diff).toBeLessThanOrEqual(3600000);
		});

		it("passes delay as startAfter to queue publish", async () => {
			const { deps, queue } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			await client.trigger(
				"test-wf",
				{ userId: "u1" },
				{
					delay: "10m",
				},
			);

			expect(queue.calls).toHaveLength(1);
			const opts = queue.calls[0].options;
			expect(opts).toBeDefined();
			expect(opts.startAfter).toBeInstanceOf(Date);
		});

		it("passes startAt as startAfter to queue publish", async () => {
			const { deps, queue } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const future = new Date(Date.now() + 60000);
			await client.trigger(
				"test-wf",
				{ userId: "u1" },
				{
					startAt: future,
				},
			);

			expect(queue.calls).toHaveLength(1);
			expect(queue.calls[0].options.startAfter).toEqual(future);
		});

		it("stores parentInstanceId and parentStepName", async () => {
			const instanceStore = new Map<string, any>();
			const { deps } = createDeps({
				instances: createMockCrud(instanceStore),
			});
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			await client.trigger(
				"test-wf",
				{ userId: "u1" },
				{
					parentInstanceId: "parent-1",
					parentStepName: "spawn-child",
				},
			);

			const instance = instanceStore.values().next().value;
			expect(instance.parentInstanceId).toBe("parent-1");
			expect(instance.parentStepName).toBe("spawn-child");
		});
	});

	describe("cancel()", () => {
		it("cancels a running instance", async () => {
			const instanceStore = new Map<string, any>();
			const { deps } = createDeps({
				instances: createMockCrud(instanceStore),
			});
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const { instanceId } = await client.trigger("test-wf", {
				userId: "u1",
			});

			// Simulate status change to running
			const inst = instanceStore.get(instanceId);
			inst.status = "running";

			const result = await client.cancel(instanceId);
			expect(result.success).toBe(true);
			expect(inst.status).toBe("cancelled");
			expect(inst.completedAt).toBeInstanceOf(Date);
		});

		it("returns false for non-existent instance", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const result = await client.cancel("non-existent");
			expect(result.success).toBe(false);
		});

		it("returns false for already completed instance", async () => {
			const instanceStore = new Map<string, any>();
			const { deps } = createDeps({
				instances: createMockCrud(instanceStore),
			});
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const { instanceId } = await client.trigger("test-wf", {
				userId: "u1",
			});
			const inst = instanceStore.get(instanceId);
			inst.status = "completed";

			const result = await client.cancel(instanceId);
			expect(result.success).toBe(false);
		});

		it("cancels a suspended instance", async () => {
			const instanceStore = new Map<string, any>();
			const { deps } = createDeps({
				instances: createMockCrud(instanceStore),
			});
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const { instanceId } = await client.trigger("test-wf", {
				userId: "u1",
			});
			const inst = instanceStore.get(instanceId);
			inst.status = "suspended";

			const result = await client.cancel(instanceId);
			expect(result.success).toBe(true);
			expect(inst.status).toBe("cancelled");
		});
	});

	describe("getInstance()", () => {
		it("returns instance by id", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const { instanceId } = await client.trigger("test-wf", {
				userId: "u1",
			});
			const instance = await client.getInstance(instanceId);

			expect(instance).not.toBeNull();
			expect(instance.id).toBe(instanceId);
			expect(instance.name).toBe("test-wf");
			expect(instance.status).toBe("pending");
		});

		it("returns null for non-existent id", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const instance = await client.getInstance("non-existent");
			expect(instance).toBeNull();
		});
	});

	describe("getHistory()", () => {
		it("returns step records for an instance", async () => {
			const stepStore = new Map<string, any>();
			const stepsCrud = createMockCrud(stepStore);
			const { deps } = createDeps({ steps: stepsCrud });
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const { instanceId } = await client.trigger("test-wf", {
				userId: "u1",
			});

			// Manually insert some steps
			await stepsCrud.create({
				instanceId,
				name: "step-1",
				type: "run",
				status: "completed",
				result: { data: "hello" },
			});
			await stepsCrud.create({
				instanceId,
				name: "step-2",
				type: "sleep",
				status: "sleeping",
			});

			const history = await client.getHistory(instanceId);
			expect(history).toHaveLength(2);
			expect(history[0].name).toBe("step-1");
			expect(history[1].name).toBe("step-2");
		});

		it("returns empty array when no steps exist", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			const history = await client.getHistory("non-existent");
			expect(history).toHaveLength(0);
		});
	});

	describe("sendEvent()", () => {
		it("creates an event and matches waiting steps", async () => {
			const { deps } = createDeps();
			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			// Should not throw — event gets created in the events collection
			await client.sendEvent("user.created", { id: "u1" });
		});

		it("resumes waiting steps when publishResume is provided", async () => {
			const stepStore = new Map<string, any>();
			const stepsCrud = createMockCrud(stepStore);
			const resumeQueue = createMockQueue();

			const { deps } = createDeps({
				steps: stepsCrud,
				publishResume: resumeQueue,
			});

			const client = createWorkflowClient({ "test-wf": testWorkflow }, deps);

			// Create a waiting step
			await stepsCrud.create({
				instanceId: "inst-1",
				name: "wait-for-user",
				type: "waitForEvent",
				status: "waiting",
				eventName: "user.created",
				matchCriteria: null,
			});

			await client.sendEvent("user.created", { id: "u1" });

			// The resume job should have been published
			expect(resumeQueue.calls).toHaveLength(1);
			expect(resumeQueue.calls[0].payload.instanceId).toBe("inst-1");
			expect(resumeQueue.calls[0].payload.stepName).toBe("wait-for-user");
		});
	});
});
