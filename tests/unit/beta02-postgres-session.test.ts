import { describe, expect, test } from "bun:test";

import type { SQL } from "bun";

import {
	executeAbortable,
	probeSessionAffinity,
	resolvePostgresControl,
} from "../../packages/compiler/src/postgres-session";
import type { SchemaProjectionV1 } from "../../packages/compiler/src/schema";
import { providerObservations } from "../../packages/compiler/src/schema";

const providerSchema = {
	requiredPostgres: {
		databaseCType: "C.UTF-8",
		databaseCollation: "C.UTF-8",
		extensions: [],
		minimumMajor: 16,
	},
} as SchemaProjectionV1;

function providerSql(overrides: Readonly<Record<string, unknown>>): SQL {
	return (async (strings: TemplateStringsArray) => {
		const query = strings.join("?");
		if (!query.includes("pg_catalog.pg_database"))
			throw new Error(`unexpected provider query: ${query}`);
		return [
			{
				binaryCollationDeterministic: true,
				binaryCollationProvider: "c",
				databaseCType: "C.UTF-8",
				databaseCollation: "C.UTF-8",
				databaseEncoding: "UTF8",
				serverVersion: "17.5",
				...overrides,
			},
		];
	}) as unknown as SQL;
}

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

	test("fails closed when UTF-8 or the binary collation contract is absent", async () => {
		await expect(
			providerObservations(
				providerSql({ databaseEncoding: "LATIN1" }),
				providerSchema,
			),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "providerMismatch",
		});
		await expect(
			providerObservations(
				providerSql({
					binaryCollationDeterministic: false,
					binaryCollationProvider: "i",
				}),
				providerSchema,
			),
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
