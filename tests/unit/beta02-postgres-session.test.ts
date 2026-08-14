import { describe, expect, test } from "bun:test";

import {
	executeAbortable,
	probeSessionAffinity,
	resolvePostgresControl,
} from "../../packages/compiler/src/postgres-session";

describe("BETA-02 PostgreSQL session protocol", () => {
	test("commits two probes and accepts only one pinned backend", async () => {
		const observed: number[] = [];
		const pid = await probeSessionAffinity(async () => {
			observed.push(observed.length + 1);
			return 4172;
		});

		expect(pid).toBe(4172);
		expect(observed).toEqual([1, 2]);
	});

	test("rejects a provider that changes backend between committed probes", async () => {
		const pids = [4172, 4173];

		await expect(
			probeSessionAffinity(async () => pids.shift() ?? -1),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "providerMismatch",
		});
	});

	test("requires bounded lock and statement timeout budgets", () => {
		expect(resolvePostgresControl({})).toEqual({
			lockTimeoutMs: 5_000,
			statementTimeoutMs: 30_000,
		});
		expect(
			resolvePostgresControl({ lockTimeoutMs: 50, statementTimeoutMs: 500 }),
		).toEqual({ lockTimeoutMs: 50, statementTimeoutMs: 500 });
		expect(() =>
			resolvePostgresControl({ lockTimeoutMs: 500, statementTimeoutMs: 50 }),
		).toThrow(RangeError);
	});

	test("cancels an executing query when its command signal aborts", async () => {
		const controller = new AbortController();
		let rejectQuery: (reason: Error) => void = () => {};
		const pending = new Promise<never>((_resolve, reject) => {
			rejectQuery = reject;
		});
		const query = Object.assign(pending, {
			active: true,
			cancelled: false,
			execute: () => query,
			cancel: () => {
				query.cancelled = true;
				rejectQuery(
					Object.assign(new Error("cancelled"), { code: "cancelled" }),
				);
				return query;
			},
		});

		const result = executeAbortable(query, controller.signal);
		controller.abort();
		await expect(result).rejects.toMatchObject({ code: "cancelled" });
		expect(query.cancelled).toBe(true);
	});
});
