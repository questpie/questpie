import { describe, expect, test } from "bun:test";

import type { SQL } from "bun";

import {
	acquireSessionLock,
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

function providerSql(
	overrides: Readonly<Record<string, unknown>>,
	extensions: readonly Readonly<{
		name: string;
		installedVersion: unknown;
	}>[] = [],
): SQL {
	return ((strings: TemplateStringsArray | readonly string[]) => {
		if (!("raw" in strings)) return strings;
		const query = strings.join("?");
		if (query.includes("pg_catalog.pg_database"))
			return Promise.resolve([
				{
					binaryCollationDeterministic: true,
					binaryCollationProvider: "c",
					databaseCType: "C.UTF-8",
					databaseCollation: "C.UTF-8",
					databaseEncoding: "UTF8",
					serverVersion: "17.5",
					...overrides,
				},
			]);
		if (query.includes("pg_catalog.pg_extension"))
			return Promise.resolve(extensions);
		throw new Error(`unexpected provider query: ${query}`);
	}) as unknown as SQL;
}

describe("BETA-02 PostgreSQL session protocol", () => {
	test("restores the configured lock timeout after the final advisory-lock attempt", async () => {
		for (const finalAttempt of ["success", "failure"] as const) {
			const commands: string[] = [];
			const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
				const command = strings.join("?").replaceAll(/\s+/g, " ").trim();
				commands.push(`${command} ${values.join(" ")}`);
				if (command.includes("pg_try_advisory_lock")) {
					const query = Object.assign(Promise.resolve([{ acquired: false }]), {
						cancel: () => query,
						execute: () => query,
					});
					return query;
				}
				if (command.includes("pg_advisory_lock") && finalAttempt === "failure")
					return Promise.reject(new Error("lock timeout"));
				return Promise.resolve([]);
			}) as unknown as SQL;

			const result = acquireSessionLock(
				sql,
				17n,
				{ lockTimeoutMs: 1, statementTimeoutMs: 100 },
				new AbortController().signal,
			);
			if (finalAttempt === "failure")
				await expect(result).rejects.toThrow("lock timeout");
			else await expect(result).resolves.toBeUndefined();

			expect(commands.slice(-3)).toEqual([
				expect.stringContaining("set_config('lock_timeout', '1ms', false)"),
				expect.stringContaining("pg_advisory_lock"),
				expect.stringContaining("set_config( 'lock_timeout', ?, false ) 1ms"),
			]);
		}
	});

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
			diagnosticClass: "unsupportedPostgres",
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
			diagnosticClass: "unsupportedPostgres",
		});
	});

	test("reports closed provider-profile subtype diagnostics", async () => {
		await expect(
			providerObservations(
				providerSql({ serverVersion: "15.9" }),
				providerSchema,
			),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "unsupportedPostgres",
		});

		const extensionSchema = {
			...providerSchema,
			requiredPostgres: {
				...providerSchema.requiredPostgres,
				extensions: [{ name: "pgcrypto" }],
			},
		};
		await expect(
			providerObservations(providerSql({}), extensionSchema),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "missingExtension",
		});
		await expect(
			providerObservations(
				providerSql({}, [{ name: "pgcrypto", installedVersion: "" }]),
				extensionSchema,
			),
		).rejects.toMatchObject({
			code: "QP-SCHEMA-007",
			diagnosticClass: "incompatibleExtension",
		});
		const observations = await providerObservations(
			providerSql({}, [
				{ name: "pgcrypto", installedVersion: "1.3-provider-build" },
			]),
			extensionSchema,
		);
		expect(observations).toEqual({
			serverVersion: "17.5",
			databaseCollation: "C.UTF-8",
			databaseCType: "C.UTF-8",
			extensions: [
				{ name: "pgcrypto", installedVersion: "1.3-provider-build" },
			],
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
