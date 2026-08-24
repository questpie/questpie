import { expect, test } from "bun:test";

import { failRuntimeApplicationStartup } from "../../packages/runtime/src/application/startup-cleanup";

test("closes one partially ready Runtime and preserves its startup failure", async () => {
	const primary = Object.freeze({ stage: "route Action projection" });
	const cleanupFailure = new Error("cleanup failed");
	const calls: string[] = [];
	const before = Date.now() + 30_000;
	await expect(
		failRuntimeApplicationStartup({
			error: primary,
			abort: () => {
				calls.push("abort");
			},
			runtime: {
				close: ({ deadlineAt }) => {
					expect(deadlineAt).toBeGreaterThanOrEqual(before);
					expect(deadlineAt).toBeLessThanOrEqual(Date.now() + 30_000);
					calls.push("runtime.close");
					return Promise.reject(cleanupFailure);
				},
			},
			closeSql: () => {
				calls.push("sql.close");
				return Promise.reject(cleanupFailure);
			},
		}),
	).rejects.toBe(primary);
	expect(calls).toEqual(["abort", "runtime.close", "sql.close"]);
});
