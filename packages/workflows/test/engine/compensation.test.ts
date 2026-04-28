import { describe, expect, it } from "bun:test";

import type { CompensationEntry } from "../../src/server/engine/compensation.js";
import {
	createCompletedStepsMap,
	runCompensations,
} from "../../src/server/engine/compensation.js";
import type { WorkflowLogger } from "../../src/server/workflow/types.js";

function createSilentLogger(): WorkflowLogger {
	return {
		debug() {},
		info() {},
		warn() {},
		error() {},
	};
}

describe("runCompensations", () => {
	it("runs compensations in reverse order (LIFO)", async () => {
		const order: string[] = [];

		const compensations: CompensationEntry[] = [
			{
				name: "step-a",
				fn: async () => {
					order.push("a");
				},
				result: "a-result",
			},
			{
				name: "step-b",
				fn: async () => {
					order.push("b");
				},
				result: "b-result",
			},
			{
				name: "step-c",
				fn: async () => {
					order.push("c");
				},
				result: "c-result",
			},
		];

		const result = await runCompensations(compensations, createSilentLogger());

		expect(order).toEqual(["c", "b", "a"]);
		expect(result.succeeded).toBe(3);
		expect(result.failed).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it("passes step result to compensation callback", async () => {
		const receivedResults: unknown[] = [];

		const compensations: CompensationEntry[] = [
			{
				name: "step-a",
				fn: async (result) => {
					receivedResults.push(result);
				},
				result: { data: "hello" },
			},
		];

		await runCompensations(compensations, createSilentLogger());

		expect(receivedResults).toEqual([{ data: "hello" }]);
	});

	it("continues running after a compensation fails", async () => {
		const order: string[] = [];

		const compensations: CompensationEntry[] = [
			{
				name: "step-a",
				fn: async () => {
					order.push("a");
				},
				result: null,
			},
			{
				name: "step-b",
				fn: async () => {
					throw new Error("compensation B failed");
				},
				result: null,
			},
			{
				name: "step-c",
				fn: async () => {
					order.push("c");
				},
				result: null,
			},
		];

		const result = await runCompensations(compensations, createSilentLogger());

		// c runs first (reverse), b fails, a still runs
		expect(order).toEqual(["c", "a"]);
		expect(result.succeeded).toBe(2);
		expect(result.failed).toBe(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0].stepName).toBe("step-b");
		expect(result.errors[0].error).toBe("compensation B failed");
	});

	it("returns empty result for no compensations", async () => {
		const result = await runCompensations([], createSilentLogger());

		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(0);
		expect(result.errors).toHaveLength(0);
	});

	it("handles all compensations failing", async () => {
		const compensations: CompensationEntry[] = [
			{
				name: "step-a",
				fn: async () => {
					throw new Error("fail-a");
				},
				result: null,
			},
			{
				name: "step-b",
				fn: async () => {
					throw new Error("fail-b");
				},
				result: null,
			},
		];

		const result = await runCompensations(compensations, createSilentLogger());

		expect(result.succeeded).toBe(0);
		expect(result.failed).toBe(2);
		expect(result.errors).toHaveLength(2);
	});
});

describe("createCompletedStepsMap", () => {
	it("has() returns true for existing steps", () => {
		const map = createCompletedStepsMap([
			{ name: "step-a", result: 1 },
			{ name: "step-b", result: 2 },
		]);

		expect(map.has("step-a")).toBe(true);
		expect(map.has("step-b")).toBe(true);
		expect(map.has("step-c")).toBe(false);
	});

	it("get() returns step result", () => {
		const map = createCompletedStepsMap([
			{ name: "step-a", result: { data: "hello" } },
		]);

		expect(map.get("step-a")).toEqual({ data: "hello" });
		expect(map.get("step-b")).toBeUndefined();
	});

	it("entries() iterates over all entries", () => {
		const map = createCompletedStepsMap([
			{ name: "step-a", result: 1 },
			{ name: "step-b", result: 2 },
		]);

		const entries = Array.from(map.entries());
		expect(entries).toEqual([
			["step-a", 1],
			["step-b", 2],
		]);
	});
});
