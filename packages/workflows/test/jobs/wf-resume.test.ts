import { describe, expect, it } from "bun:test";

import { wfResumeJob } from "../../src/server/modules/workflows/jobs/wf-resume.js";
import { createJobContext, createMockStores } from "./helpers.js";

const handler = wfResumeJob.handler;

describe("wf-resume job", () => {
	it("marks a sleeping step as completed and re-queues execute", async () => {
		const stores = createMockStores();
		const { ctx, queue } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "my-sleep",
			},
			{ stores },
		);

		// Pre-populate a sleeping step
		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "my-sleep",
			type: "sleep",
			status: "sleeping",
			createdAt: new Date(),
		});

		// Pre-populate instance
		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "test-wf",
			status: "suspended",
			createdAt: new Date(),
		});

		await handler(ctx);

		// Step should be marked completed
		const step = stores.steps.get("step-1");
		expect(step.status).toBe("completed");
		expect(step.completedAt).toBeInstanceOf(Date);

		// Execute job should be re-queued
		const executeChannel = queue.wfExecute;
		expect(executeChannel.calls).toHaveLength(1);
		expect(executeChannel.calls[0].payload).toEqual({
			instanceId: "inst-1",
			workflowName: "test-wf",
		});
	});

	it("marks a waiting step as completed with result data", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "wait-event",
				result: { userId: "u1" },
			},
			{ stores },
		);

		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "wait-event",
			type: "waitForEvent",
			status: "waiting",
			createdAt: new Date(),
		});

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "event-wf",
			status: "suspended",
			createdAt: new Date(),
		});

		await handler(ctx);

		const step = stores.steps.get("step-1");
		expect(step.status).toBe("completed");
		expect(step.result).toEqual({ userId: "u1" });
	});

	it("skips already completed steps", async () => {
		const stores = createMockStores();
		const { ctx, queue } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "done-step",
			},
			{ stores },
		);

		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "done-step",
			type: "run",
			status: "completed",
			createdAt: new Date(),
		});

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "test-wf",
			status: "running",
			createdAt: new Date(),
		});

		// Should not throw, just return early
		await handler(ctx);

		// No execute job should be queued
		const executeChannel = queue._channels.get("wfExecute");
		expect(executeChannel?.calls ?? []).toHaveLength(0);
	});

	it("skips failed steps", async () => {
		const stores = createMockStores();
		const { ctx, queue } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "failed-step",
			},
			{ stores },
		);

		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "failed-step",
			type: "run",
			status: "failed",
			createdAt: new Date(),
		});

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "test-wf",
			status: "running",
			createdAt: new Date(),
		});

		await handler(ctx);

		const executeChannel = queue._channels.get("wfExecute");
		expect(executeChannel?.calls ?? []).toHaveLength(0);
	});

	it("throws when step is not found", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "non-existent",
			},
			{ stores },
		);

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "test-wf",
			status: "running",
			createdAt: new Date(),
		});

		await expect(handler(ctx)).rejects.toThrow("Step not found");
	});

	it("throws when instance is not found", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "my-sleep",
			},
			{ stores },
		);

		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "my-sleep",
			type: "sleep",
			status: "sleeping",
			createdAt: new Date(),
		});

		await expect(handler(ctx)).rejects.toThrow("Instance not found");
	});

	it("throws when collections are missing", async () => {
		const ctx: any = {
			payload: { instanceId: "inst-1", stepName: "step" },
			collections: {},
			queue: {},
		};

		await expect(handler(ctx)).rejects.toThrow(
			"Workflow system collections not found",
		);
	});

	it("stores null result when result is not provided", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext(
			{
				instanceId: "inst-1",
				stepName: "my-sleep",
				// no result field
			},
			{ stores },
		);

		stores.steps.set("step-1", {
			id: "step-1",
			instanceId: "inst-1",
			name: "my-sleep",
			type: "sleep",
			status: "sleeping",
			createdAt: new Date(),
		});

		stores.instances.set("inst-1", {
			id: "inst-1",
			name: "test-wf",
			status: "suspended",
			createdAt: new Date(),
		});

		await handler(ctx);

		const step = stores.steps.get("step-1");
		expect(step.status).toBe("completed");
		expect(step.result).toBeNull();
	});
});
