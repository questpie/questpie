import { expect, test } from "bun:test";

import type { SQL } from "bun";

import { internalProtocolV7Catalog } from "../../packages/compiler/src/schema/postgres/internal-protocol-v7";
import {
	assertProtocolV8Cutover,
	ensureInternalProtocolV8,
	internalProtocolV8Catalog,
	internalProtocolV8Checksum,
} from "../../packages/compiler/src/schema/postgres/internal-protocol-v8";

test("pins protocol v8 to the accepted three-column catalog delta", () => {
	expect(internalProtocolV8Checksum).toBe(
		"aaa61de44f277d1c6671f6de5ea791ca02d39a42407aff71659b378373e024d5",
	);
	expect(internalProtocolV8Catalog.tables).toHaveLength(21);
	expect(internalProtocolV8Catalog.tables).toEqual(
		internalProtocolV7Catalog.tables,
	);
	expect(internalProtocolV8Catalog.columns).toHaveLength(
		internalProtocolV7Catalog.columns.length + 3,
	);
	expect(internalProtocolV8Catalog.constraints).toHaveLength(
		internalProtocolV7Catalog.constraints.length + 1,
	);
	expect(internalProtocolV8Catalog.indexes).toEqual(
		internalProtocolV7Catalog.indexes,
	);
	expect(
		internalProtocolV8Catalog.columns.filter(
			([table, column]) =>
				table === "durable_runs" &&
				["trace_id", "span_id", "trace_flags"].includes(column),
		),
	).toEqual([
		["durable_runs", "trace_id", "bytea", false],
		["durable_runs", "span_id", "bytea", false],
		["durable_runs", "trace_flags", "smallint", false],
	]);
	expect(
		internalProtocolV8Catalog.constraints.filter(
			([table, constraint]) =>
				table === "durable_runs" &&
				constraint === "durable_run_trace_context_complete",
		),
	).toHaveLength(1);
});

test("requires explicit acknowledgement only for an existing pre-v8 database", () => {
	const existingV7 = { version: 7, checksum: "a".repeat(64) };

	expect(() => assertProtocolV8Cutover(existingV7, {})).toThrow(
		"protocol v8 is a non-rolling upgrade",
	);
	expect(() =>
		assertProtocolV8Cutover(existingV7, {
			allowNonRollingProtocolV8: true,
		}),
	).not.toThrow();
	expect(() => assertProtocolV8Cutover(undefined, {})).not.toThrow();
	expect(() =>
		assertProtocolV8Cutover({ version: 8, checksum: "b".repeat(64) }, {}),
	).not.toThrow();
});

test("does not treat an initial protocol read failure as a fresh install", async () => {
	const statements: string[] = [];
	const readFailure = Object.assign(new Error("protocol read denied"), {
		code: "42501",
	});
	const sql = ((strings: TemplateStringsArray) => {
		const statement = strings.join("?");
		statements.push(statement);
		if (statement.includes("pg_catalog.pg_backend_pid"))
			return Promise.resolve([{ pid: 41 }]);
		if (statement.includes("questpie_internal.protocol"))
			return Promise.reject(readFailure);
		throw new Error(`unexpected SQL: ${statement}`);
	}) as unknown as SQL;

	await expect(
		ensureInternalProtocolV8(sql, "questpie", 41, {
			lockTimeoutMs: 5_000,
			statementTimeoutMs: 30_000,
		}),
	).rejects.toBe(readFailure);
	expect(statements).toHaveLength(2);
});
