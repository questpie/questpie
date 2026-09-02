import { expect, test } from "bun:test";

import {
	definePostgresAdministrativeStatement,
	definePostgresStatement,
} from "../../packages/runtime/src/postgres/contract";

const definition = {
	name: "otel03.statement-contract",
	text: "SELECT 1",
	parameterCount: 0,
	parameters: (_input: void) => [],
	decode: () => undefined,
} as const;

test("requires one closed authored operation for observable and administrative statements", () => {
	for (const operation of [
		"SELECT",
		"INSERT",
		"UPDATE",
		"DELETE",
		"CALL",
	] as const)
		expect(
			definePostgresStatement({ ...definition, operation }).operation,
		).toBe(operation);
	expect(() =>
		definePostgresStatement({ ...definition, operation: "CREATE" as never }),
	).toThrow("invalid PostgreSQL statement operation");
	expect(() =>
		definePostgresStatement({
			...definition,
			operation: "administrative" as never,
		}),
	).toThrow("invalid PostgreSQL statement operation");
	expect(
		definePostgresAdministrativeStatement({
			...definition,
			text: "CREATE TEMP TABLE qp_otel03_probe (id integer)",
		}).operation,
	).toBe("administrative");
});
