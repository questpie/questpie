import { expect, test } from "bun:test";

import type { SQL } from "bun";

import {
	assertProtocolV7Cutover,
	ensureInternalProtocolV7,
} from "../../packages/compiler/src/schema/postgres/internal-protocol-v7";

test("requires explicit acknowledgement only for an existing pre-v7 database", () => {
	const existingV6 = { version: 6, checksum: "a".repeat(64) };

	expect(() => assertProtocolV7Cutover(existingV6, {})).toThrow(
		"protocol v7 is a non-rolling upgrade",
	);
	expect(() =>
		assertProtocolV7Cutover(existingV6, {
			allowNonRollingProtocolV7: true,
		}),
	).not.toThrow();
	expect(() => assertProtocolV7Cutover(undefined, {})).not.toThrow();
	expect(() =>
		assertProtocolV7Cutover({ version: 7, checksum: "b".repeat(64) }, {}),
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
		ensureInternalProtocolV7(sql, "questpie", 41, {
			lockTimeoutMs: 5_000,
			statementTimeoutMs: 30_000,
		}),
	).rejects.toBe(readFailure);
	expect(statements).toHaveLength(2);
});
