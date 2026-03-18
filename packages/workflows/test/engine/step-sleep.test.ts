import { describe, expect, test } from "bun:test";
import { StepSuspendError } from "../../src/server/engine/errors.js";
import { createTestStepContext } from "./helpers.js";

describe("step.sleep()", () => {
	test("creates sleeping step and throws StepSuspendError", async () => {
		const { ctx, log } = createTestStepContext();

		try {
			await ctx.sleep("delay-5m", "5m");
			throw new Error("should not reach here");
		} catch (error) {
			expect(error).toBeInstanceOf(StepSuspendError);
			const suspend = error as StepSuspendError;
			expect(suspend.reason).toBe("sleep");
			expect(suspend.stepName).toBe("delay-5m");
			expect(suspend.resumeAt).toBeDefined();
			// resumeAt should be ~5 minutes in the future
			const diff = suspend.resumeAt!.getTime() - Date.now();
			expect(diff).toBeGreaterThan(4 * 60 * 1000); // > 4m
			expect(diff).toBeLessThan(6 * 60 * 1000); // < 6m
		}

		// Should have persisted the step
		expect(log.created).toHaveLength(1);
		expect(log.created[0].name).toBe("delay-5m");
		expect(log.created[0].type).toBe("sleep");
		expect(log.created[0].status).toBe("sleeping");
		expect(log.created[0].scheduledAt).toBeDefined();
	});

	test("returns immediately when cached step is completed (resumed)", async () => {
		const { ctx, log } = createTestStepContext({
			cachedSteps: [
				{
					name: "delay-5m",
					type: "sleep",
					status: "completed",
					result: null,
					error: null,
					attempt: 1,
					scheduledAt: new Date("2026-01-01T00:05:00Z"),
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["delay-5m"],
		});

		// Should NOT throw — step was already resumed
		await ctx.sleep("delay-5m", "5m");

		// No new step created
		expect(log.created).toHaveLength(0);
		expect(log.updated).toHaveLength(0);
	});
});

describe("step.sleepUntil()", () => {
	test("creates sleeping step with absolute date and throws", async () => {
		const { ctx, log } = createTestStepContext();
		const targetDate = new Date("2026-06-01T00:00:00Z");

		try {
			await ctx.sleepUntil("wait-until-june", targetDate);
			throw new Error("should not reach here");
		} catch (error) {
			expect(error).toBeInstanceOf(StepSuspendError);
			const suspend = error as StepSuspendError;
			expect(suspend.reason).toBe("sleepUntil");
			expect(suspend.stepName).toBe("wait-until-june");
			expect(suspend.resumeAt).toBe(targetDate);
		}

		expect(log.created).toHaveLength(1);
		expect(log.created[0].type).toBe("sleepUntil");
		expect(log.created[0].scheduledAt).toBe(targetDate);
	});

	test("returns immediately when cached step is completed", async () => {
		const { ctx } = createTestStepContext({
			cachedSteps: [
				{
					name: "wait-until-june",
					type: "sleepUntil",
					status: "completed",
					result: null,
					error: null,
					attempt: 1,
					scheduledAt: new Date("2026-06-01T00:00:00Z"),
					hasCompensation: false,
				},
			],
			cachedExecutionOrder: ["wait-until-june"],
		});

		// Should NOT throw
		await ctx.sleepUntil("wait-until-june", new Date("2026-06-01T00:00:00Z"));
	});
});
