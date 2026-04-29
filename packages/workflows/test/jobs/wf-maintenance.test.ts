import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { wfMaintenanceJob } from "../../src/server/modules/workflows/jobs/wf-maintenance.js";
import type { WorkflowDefinition } from "../../src/server/workflow/types.js";
import { createJobContext, createMockStores } from "./helpers.js";

const handler = wfMaintenanceJob.handler;

describe("wf-maintenance job", () => {
	describe("sleeping step resume", () => {
		it("publishes resume jobs for sleeping steps past scheduledAt", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createJobContext({}, { stores, workflows: {} });

			// A sleeping step whose scheduledAt is in the past
			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "nap",
				type: "sleep",
				status: "sleeping",
				scheduledAt: new Date(Date.now() - 60000), // 1 min ago
				createdAt: new Date(),
			});

			await handler(ctx);

			const resumeChannel = queue["questpie-wf-resume"];
			expect(resumeChannel.calls).toHaveLength(1);
			expect(resumeChannel.calls[0].payload).toEqual({
				instanceId: "inst-1",
				stepName: "nap",
			});
		});

		it("does not resume sleeping steps still in the future", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createJobContext({}, { stores, workflows: {} });

			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "nap",
				type: "sleep",
				status: "sleeping",
				scheduledAt: new Date(Date.now() + 3600000), // 1 hour from now
				createdAt: new Date(),
			});

			await handler(ctx);

			const resumeChannel = queue._channels.get("questpie-wf-resume");
			expect(resumeChannel?.calls ?? []).toHaveLength(0);
		});

		it("does not resume non-sleeping steps", async () => {
			const stores = createMockStores();
			const { ctx, queue } = createJobContext({}, { stores, workflows: {} });

			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "inst-1",
				name: "done",
				type: "run",
				status: "completed",
				scheduledAt: new Date(Date.now() - 60000),
				createdAt: new Date(),
			});

			await handler(ctx);

			const resumeChannel = queue._channels.get("questpie-wf-resume");
			expect(resumeChannel?.calls ?? []).toHaveLength(0);
		});
	});

	describe("timeout detection", () => {
		it("times out instances with expired timeoutAt", async () => {
			const stores = createMockStores();
			const { ctx } = createJobContext({}, { stores, workflows: {} });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				timeoutAt: new Date(Date.now() - 60000), // expired
				createdAt: new Date(),
			});

			await handler(ctx);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("timed_out");
			expect(instance.error).toBeDefined();
			expect(instance.error.code).toBe("WORKFLOW_TIMEOUT");
			expect(instance.completedAt).toBeInstanceOf(Date);
		});

		it("times out pending instances with expired timeoutAt", async () => {
			const stores = createMockStores();
			const { ctx } = createJobContext({}, { stores, workflows: {} });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "pending",
				timeoutAt: new Date(Date.now() - 60000),
				createdAt: new Date(),
			});

			await handler(ctx);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("timed_out");
		});

		it("times out suspended instances with expired timeoutAt", async () => {
			const stores = createMockStores();
			const { ctx } = createJobContext({}, { stores, workflows: {} });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "suspended",
				timeoutAt: new Date(Date.now() - 60000),
				createdAt: new Date(),
			});

			await handler(ctx);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("timed_out");
		});

		it("does not time out instances with future timeoutAt", async () => {
			const stores = createMockStores();
			const { ctx } = createJobContext({}, { stores, workflows: {} });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "running",
				timeoutAt: new Date(Date.now() + 3600000), // 1 hour from now
				createdAt: new Date(),
			});

			await handler(ctx);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("running");
		});

		it("does not time out already completed instances", async () => {
			const stores = createMockStores();
			const { ctx } = createJobContext({}, { stores, workflows: {} });

			stores.instances.set("inst-1", {
				id: "inst-1",
				name: "test-wf",
				status: "completed",
				timeoutAt: new Date(Date.now() - 60000),
				createdAt: new Date(),
			});

			await handler(ctx);

			const instance = stores.instances.get("inst-1");
			expect(instance.status).toBe("completed");
		});
	});

	describe("cron triggers", () => {
		it("triggers cron-scheduled workflows", async () => {
			const stores = createMockStores();
			// A cron workflow that runs every minute
			const cronWf: WorkflowDefinition = {
				name: "cron-wf",
				schema: z.object({}),
				cron: "* * * * *", // every minute — should fire in any 5-min window
				handler: async () => {},
			};

			const { ctx, queue } = createJobContext(
				{},
				{ stores, workflows: { "cron-wf": cronWf } },
			);

			await handler(ctx);

			// Instance should be created
			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(1);
			expect(instances[0].name).toBe("cron-wf");
			expect(instances[0].status).toBe("pending");

			// Execute job should be queued
			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
		});

		it("skips cron trigger when overlap policy is skip and instance is running", async () => {
			const stores = createMockStores();
			const cronWf: WorkflowDefinition = {
				name: "cron-wf",
				schema: z.object({}),
				cron: "* * * * *",
				cronOverlap: "skip",
				handler: async () => {},
			};

			const { ctx, queue } = createJobContext(
				{},
				{ stores, workflows: { "cron-wf": cronWf } },
			);

			// Existing running instance
			stores.instances.set("running-1", {
				id: "running-1",
				name: "cron-wf",
				status: "running",
				createdAt: new Date(),
			});

			await handler(ctx);

			// No new instance should be created (only the pre-existing one)
			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(1);
			expect(instances[0].id).toBe("running-1");

			// No execute job should be queued
			const executeChannel = queue._channels.get("questpie-wf-execute");
			expect(executeChannel?.calls ?? []).toHaveLength(0);
		});

		it("cancels previous when overlap policy is cancel-previous", async () => {
			const stores = createMockStores();
			const cronWf: WorkflowDefinition = {
				name: "cron-wf",
				schema: z.object({}),
				cron: "* * * * *",
				cronOverlap: "cancel-previous",
				handler: async () => {},
			};

			const { ctx, queue } = createJobContext(
				{},
				{ stores, workflows: { "cron-wf": cronWf } },
			);

			// Existing running instance
			stores.instances.set("running-1", {
				id: "running-1",
				name: "cron-wf",
				status: "running",
				createdAt: new Date(),
			});

			await handler(ctx);

			// Old instance should be cancelled
			const oldInstance = stores.instances.get("running-1");
			expect(oldInstance.status).toBe("cancelled");
			expect(oldInstance.error.code).toBe("CRON_OVERLAP_CANCELLED");

			// New instance should be created
			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(2);
			const newInstance = instances.find((i: any) => i.id !== "running-1");
			expect(newInstance).toBeDefined();
			expect(newInstance?.name).toBe("cron-wf");
			expect(newInstance?.status).toBe("pending");

			// Execute job should be queued for new instance
			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
		});

		it("allows overlap when policy is allow", async () => {
			const stores = createMockStores();
			const cronWf: WorkflowDefinition = {
				name: "cron-wf",
				schema: z.object({}),
				cron: "* * * * *",
				cronOverlap: "allow",
				handler: async () => {},
			};

			const { ctx, queue } = createJobContext(
				{},
				{ stores, workflows: { "cron-wf": cronWf } },
			);

			// Existing running instance
			stores.instances.set("running-1", {
				id: "running-1",
				name: "cron-wf",
				status: "running",
				createdAt: new Date(),
			});

			await handler(ctx);

			// Old instance should still be running
			expect(stores.instances.get("running-1").status).toBe("running");

			// New instance should also exist
			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(2);

			// Execute job queued
			const executeChannel = queue["questpie-wf-execute"];
			expect(executeChannel.calls).toHaveLength(1);
		});

		it("does not trigger non-cron workflows", async () => {
			const stores = createMockStores();
			const normalWf: WorkflowDefinition = {
				name: "normal-wf",
				schema: z.object({}),
				handler: async () => {},
			};

			const { ctx, queue } = createJobContext(
				{},
				{ stores, workflows: { "normal-wf": normalWf } },
			);

			await handler(ctx);

			const instances = Array.from(stores.instances.values());
			expect(instances).toHaveLength(0);

			const executeChannel = queue._channels.get("questpie-wf-execute");
			expect(executeChannel?.calls ?? []).toHaveLength(0);
		});
	});

	describe("retention cleanup", () => {
		it("cleans up completed instances past retention period", async () => {
			const stores = createMockStores();
			const retentionWf: WorkflowDefinition = {
				name: "ret-wf",
				schema: z.object({}),
				retention: {
					completedAfter: "1h",
				},
				handler: async () => {},
			};

			const { ctx } = createJobContext(
				{},
				{ stores, workflows: { "ret-wf": retentionWf } },
			);

			// Old completed instance (2 hours ago)
			const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
			stores.instances.set("old-1", {
				id: "old-1",
				name: "ret-wf",
				status: "completed",
				completedAt: twoHoursAgo,
				createdAt: twoHoursAgo,
			});

			// Recent completed instance (10 minutes ago)
			const tenMinAgo = new Date(Date.now() - 600000);
			stores.instances.set("recent-1", {
				id: "recent-1",
				name: "ret-wf",
				status: "completed",
				completedAt: tenMinAgo,
				createdAt: tenMinAgo,
			});

			await handler(ctx);

			// Old instance should be cleaned up
			expect(stores.instances.has("old-1")).toBe(false);
			// Recent instance should remain
			expect(stores.instances.has("recent-1")).toBe(true);
		});

		it("cleans up failed instances past retention period", async () => {
			const stores = createMockStores();
			const retentionWf: WorkflowDefinition = {
				name: "ret-wf",
				schema: z.object({}),
				retention: {
					failedAfter: "1h",
				},
				handler: async () => {},
			};

			const { ctx } = createJobContext(
				{},
				{ stores, workflows: { "ret-wf": retentionWf } },
			);

			const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
			stores.instances.set("old-1", {
				id: "old-1",
				name: "ret-wf",
				status: "failed",
				completedAt: twoHoursAgo,
				createdAt: twoHoursAgo,
			});

			await handler(ctx);

			expect(stores.instances.has("old-1")).toBe(false);
		});

		it("cleans up associated steps and logs", async () => {
			const stores = createMockStores();
			const retentionWf: WorkflowDefinition = {
				name: "ret-wf",
				schema: z.object({}),
				retention: {
					completedAfter: "1h",
				},
				handler: async () => {},
			};

			const { ctx } = createJobContext(
				{},
				{ stores, workflows: { "ret-wf": retentionWf } },
			);

			const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
			stores.instances.set("old-1", {
				id: "old-1",
				name: "ret-wf",
				status: "completed",
				completedAt: twoHoursAgo,
				createdAt: twoHoursAgo,
			});

			stores.steps.set("step-1", {
				id: "step-1",
				instanceId: "old-1",
				name: "do-work",
				createdAt: twoHoursAgo,
			});

			stores.logs.set("log-1", {
				id: "log-1",
				instanceId: "old-1",
				message: "test log",
				createdAt: twoHoursAgo,
			});

			await handler(ctx);

			expect(stores.instances.has("old-1")).toBe(false);
			expect(stores.steps.has("step-1")).toBe(false);
			expect(stores.logs.has("log-1")).toBe(false);
		});

		it("cleans up old events past retention period", async () => {
			const stores = createMockStores();
			const retentionWf: WorkflowDefinition = {
				name: "ret-wf",
				schema: z.object({}),
				retention: {
					eventsAfter: "1h",
				},
				handler: async () => {},
			};

			const { ctx } = createJobContext(
				{},
				{ stores, workflows: { "ret-wf": retentionWf } },
			);

			const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
			stores.events.set("evt-1", {
				id: "evt-1",
				eventName: "user.created",
				createdAt: twoHoursAgo,
			});

			await handler(ctx);

			expect(stores.events.has("evt-1")).toBe(false);
		});

		it("does not clean up when no retention policy defined", async () => {
			const stores = createMockStores();
			const normalWf: WorkflowDefinition = {
				name: "normal-wf",
				schema: z.object({}),
				handler: async () => {},
			};

			const { ctx } = createJobContext(
				{},
				{ stores, workflows: { "normal-wf": normalWf } },
			);

			const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
			stores.instances.set("old-1", {
				id: "old-1",
				name: "normal-wf",
				status: "completed",
				completedAt: twoHoursAgo,
				createdAt: twoHoursAgo,
			});

			await handler(ctx);

			expect(stores.instances.has("old-1")).toBe(true);
		});
	});

	it("throws when collections are missing", async () => {
		const ctx: any = {
			payload: {},
			collections: {},
			queue: {},
			logger: {},
			app: { state: { workflows: {} } },
		};

		await expect(handler(ctx)).rejects.toThrow(
			"Workflow system collections not found",
		);
	});

	it("handles empty stores gracefully", async () => {
		const stores = createMockStores();
		const { ctx } = createJobContext({}, { stores, workflows: {} });

		// Should not throw when there's nothing to process
		await handler(ctx);
	});
});
