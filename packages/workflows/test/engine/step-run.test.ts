import { describe, expect, mock, test } from "bun:test";

import { createTestStepContext } from "./helpers.js";

describe("step.run()", () => {
	describe("cache miss (new step)", () => {
		test("executes function and persists result", async () => {
			const { ctx, log } = createTestStepContext();

			const result = await ctx.run("fetch-data", async () => {
				return { users: 42 };
			});

			expect(result).toEqual({ users: 42 });
			expect(log.created).toHaveLength(1);
			expect(log.created[0].name).toBe("fetch-data");
			expect(log.created[0].type).toBe("run");
			expect(log.created[0].status).toBe("completed");
			expect(log.created[0].result).toEqual({ users: 42 });
		});

		test("persists failure on error", async () => {
			const { ctx, log } = createTestStepContext();

			await expect(
				ctx.run("failing-step", async () => {
					throw new Error("network timeout");
				}),
			).rejects.toThrow("network timeout");

			expect(log.created).toHaveLength(1);
			expect(log.created[0].status).toBe("failed");
			expect(log.created[0].error).toEqual(
				expect.objectContaining({ message: "network timeout" }),
			);
		});
	});

	describe("cache hit (replay)", () => {
		test("returns cached result without executing function", async () => {
			const fn = mock(async () => "should not run");
			const { ctx } = createTestStepContext({
				cachedSteps: [
					{
						name: "fetch-data",
						type: "run",
						status: "completed",
						result: { cached: true },
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: false,
					},
				],
				cachedExecutionOrder: ["fetch-data"],
			});

			const result = await ctx.run("fetch-data", fn);

			expect(result).toEqual({ cached: true });
			expect(fn).not.toHaveBeenCalled();
		});
	});

	describe("with options", () => {
		test("accepts options as second argument", async () => {
			const { ctx, log } = createTestStepContext();

			const result = await ctx.run(
				"with-opts",
				{ retry: { maxAttempts: 5 } },
				async () => "ok",
			);

			expect(result).toBe("ok");
			expect(log.created[0].maxAttempts).toBe(5);
		});

		test("records compensation registration", async () => {
			const compensateFn = mock(async () => {});
			const { ctx } = createTestStepContext();

			await ctx.run(
				"compensable",
				{ compensate: compensateFn },
				async () => "result",
			);

			const compensations = ctx.getCompensations();
			expect(compensations).toHaveLength(1);
			expect(compensations[0].name).toBe("compensable");
			expect(compensations[0].result).toBe("result");
		});

		test("registers compensation for cached steps", async () => {
			const compensateFn = mock(async () => {});
			const { ctx } = createTestStepContext({
				cachedSteps: [
					{
						name: "compensable",
						type: "run",
						status: "completed",
						result: "cached-result",
						error: null,
						attempt: 1,
						scheduledAt: null,
						hasCompensation: true,
					},
				],
				cachedExecutionOrder: ["compensable"],
			});

			await ctx.run(
				"compensable",
				{ compensate: compensateFn },
				async () => "should not run",
			);

			const compensations = ctx.getCompensations();
			expect(compensations).toHaveLength(1);
			expect(compensations[0].result).toBe("cached-result");
		});
	});

	describe("step name validation", () => {
		test("throws on duplicate step names", async () => {
			const { ctx } = createTestStepContext();

			await ctx.run("step-a", async () => "first");

			await expect(ctx.run("step-a", async () => "duplicate")).rejects.toThrow(
				"Duplicate step name",
			);
		});
	});

	describe("execution order tracking", () => {
		test("tracks execution order", async () => {
			const { ctx } = createTestStepContext();

			await ctx.run("step-a", async () => 1);
			await ctx.run("step-b", async () => 2);
			await ctx.run("step-c", async () => 3);

			expect(ctx.getExecutionOrder()).toEqual(["step-a", "step-b", "step-c"]);
		});
	});
});
