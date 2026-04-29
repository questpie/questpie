import { describe, expect, it } from "bun:test";
import { StepSuspendError } from "../../src/server/engine/errors.js";
import {
	createMockEventPersistence,
	createMockResumeWaiter,
	createMockTriggerChild,
	createTestStepContext,
} from "./helpers.js";

describe("step.waitForEvent", () => {
	it("suspends when no retroactive event exists", async () => {
		const { persistence: eventPersistence } = createMockEventPersistence();
		const { ctx } = createTestStepContext({ eventPersistence });

		try {
			await ctx.waitForEvent("wait-profile", {
				event: "profile.completed",
				match: { userId: "u1" },
				timeout: "30m",
			});
			expect(true).toBe(false); // should not reach
		} catch (err) {
			expect(err).toBeInstanceOf(StepSuspendError);
			expect((err as StepSuspendError).reason).toBe("waitForEvent");
			expect((err as StepSuspendError).stepName).toBe("wait-profile");
		}
	});

	it("returns immediately via retroactive match", async () => {
		const { persistence: eventPersistence, store } = createMockEventPersistence(
			{
				events: [
					{
						id: "evt-1",
						eventName: "profile.completed",
						data: { userId: "u1", name: "Alice" },
						matchCriteria: { userId: "u1" },
						sourceType: "external",
						consumedCount: 0,
					},
				],
			},
		);

		const { ctx, log } = createTestStepContext({ eventPersistence });

		const result = await ctx.waitForEvent("wait-profile", {
			event: "profile.completed",
			match: { userId: "u1" },
		});

		// Got the event data immediately
		expect(result).toEqual({ userId: "u1", name: "Alice" });

		// Step was persisted as completed (not waiting)
		expect(log.created).toHaveLength(1);
		expect(log.created[0].status).toBe("completed");
		expect(log.created[0].type).toBe("waitForEvent");

		// Event was marked consumed
		expect(store.events[0].consumedCount).toBe(1);
	});

	it("returns cached result on replay", async () => {
		const { ctx } = createTestStepContext({
			cachedSteps: [
				{
					name: "wait-order",
					type: "waitForEvent",
					status: "completed",
					result: { orderId: "o1" },
					error: null,
					attempt: 1,
					scheduledAt: null,
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["wait-order"],
		});

		const result = await ctx.waitForEvent("wait-order", {
			event: "order.placed",
		});

		expect(result).toEqual({ orderId: "o1" });
	});
});

describe("step.sendEvent", () => {
	it("dispatches event and persists step as completed", async () => {
		const { persistence: eventPersistence, store } =
			createMockEventPersistence();
		const { fn: resumeWaiter, calls: resumeCalls } = createMockResumeWaiter();

		const { ctx, log } = createTestStepContext({
			eventPersistence,
			resumeWaiter,
		});

		await ctx.sendEvent("emit-welcome", {
			event: "user.welcomed",
			data: { userId: "u1" },
			match: { userId: "u1" },
		});

		// Event was created
		expect(store.events).toHaveLength(1);
		expect(store.events[0].eventName).toBe("user.welcomed");

		// Step was persisted as completed
		expect(log.created).toHaveLength(1);
		expect(log.created[0].status).toBe("completed");
		expect(log.created[0].type).toBe("sendEvent");
	});

	it("resumes matching waiters when sending", async () => {
		const { persistence: eventPersistence } = createMockEventPersistence({
			waitingSteps: [
				{
					instanceId: "inst-2",
					stepName: "wait-for-welcome",
					eventName: "user.welcomed",
					matchCriteria: null,
				},
			],
		});
		const { fn: resumeWaiter, calls: resumeCalls } = createMockResumeWaiter();

		const { ctx } = createTestStepContext({
			eventPersistence,
			resumeWaiter,
		});

		await ctx.sendEvent("emit-welcome", {
			event: "user.welcomed",
			data: { msg: "hello" },
		});

		// Waiter was resumed
		expect(resumeCalls).toHaveLength(1);
		expect(resumeCalls[0].instanceId).toBe("inst-2");
		expect(resumeCalls[0].result).toEqual({ msg: "hello" });
	});

	it("skips on replay when cached as completed", async () => {
		const { persistence: eventPersistence, store } =
			createMockEventPersistence();
		const { fn: resumeWaiter } = createMockResumeWaiter();

		const { ctx, log } = createTestStepContext({
			eventPersistence,
			resumeWaiter,
			cachedSteps: [
				{
					name: "emit-done",
					type: "sendEvent",
					status: "completed",
					result: { event: "done", data: null },
					error: null,
					attempt: 1,
					scheduledAt: null,
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["emit-done"],
		});

		await ctx.sendEvent("emit-done", {
			event: "done",
		});

		// No new event created (replayed)
		expect(store.events).toHaveLength(0);
		// No new step persisted
		expect(log.created).toHaveLength(0);
	});
});

describe("step.invoke", () => {
	it("triggers child workflow and suspends", async () => {
		const { fn: triggerChild, calls: childCalls } = createMockTriggerChild();

		const { ctx, log } = createTestStepContext({
			triggerChild,
		});

		try {
			await ctx.invoke("run-child", {
				workflow: "child-wf",
				input: { foo: "bar" },
				timeout: "1h",
			});
			expect(true).toBe(false); // should not reach
		} catch (err) {
			expect(err).toBeInstanceOf(StepSuspendError);
			expect((err as StepSuspendError).reason).toBe("invoke");
		}

		// Child was triggered
		expect(childCalls).toHaveLength(1);
		expect(childCalls[0].workflowName).toBe("child-wf");
		expect(childCalls[0].input).toEqual({ foo: "bar" });
		expect(childCalls[0].options.parentInstanceId).toBe("test-instance");
		expect(childCalls[0].options.parentStepName).toBe("run-child");

		// Step was persisted with child instance ID
		expect(log.created).toHaveLength(1);
		expect(log.created[0].childInstanceId).toBe("child-1");
		expect(log.created[0].status).toBe("waiting");
	});

	it("returns cached result on replay after child completes", async () => {
		const { ctx } = createTestStepContext({
			cachedSteps: [
				{
					name: "run-child",
					type: "invoke",
					status: "completed",
					result: { output: "from-child" },
					error: null,
					attempt: 1,
					scheduledAt: null,
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["run-child"],
		});

		const result = await ctx.invoke("run-child", {
			workflow: "child-wf",
			input: {},
		});

		expect(result).toEqual({ output: "from-child" });
	});

	it("throws when cached invoke step has failed status", async () => {
		const { ctx } = createTestStepContext({
			cachedSteps: [
				{
					name: "run-child",
					type: "invoke",
					status: "failed",
					result: null,
					error: { message: "child exploded" },
					attempt: 1,
					scheduledAt: null,
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["run-child"],
		});

		await expect(
			ctx.invoke("run-child", { workflow: "child-wf", input: {} }),
		).rejects.toThrow('Child workflow "child-wf" failed');
	});
});

describe("step.run with timeout", () => {
	it("completes before timeout", async () => {
		const { ctx } = createTestStepContext();

		const result = await ctx.run("fast-step", { timeout: "5s" }, async () => {
			return "done";
		});

		expect(result).toBe("done");
	});

	it("step.run with opts but no timeout works normally", async () => {
		const { ctx, log } = createTestStepContext();
		const compensateCalls: any[] = [];

		const result = await ctx.run(
			"comp-step",
			{
				compensate: async (res) => {
					compensateCalls.push(res);
				},
			},
			async () => "result-with-comp",
		);

		expect(result).toBe("result-with-comp");
		// Compensation was registered
		expect(ctx.getCompensations()).toHaveLength(1);
	});
});
