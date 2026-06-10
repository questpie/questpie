/**
 * Driver-result contract (`rowsOf` / `toKitDb`)
 *
 * Drizzle `db.execute()` returns driver-native shapes: node-postgres/PGlite
 * return `{ rows }`, postgres-js/bun-sql return array subclasses. The
 * contract is normalized once at this seam.
 */
import { describe, expect, test } from "bun:test";

import { rowsOf, toKitDb } from "../../src/server/db/driver-result.js";

describe("rowsOf", () => {
	test("unwraps node-postgres/PGlite shape ({ rows })", () => {
		const rows = [{ id: 1 }, { id: 2 }];
		expect(rowsOf({ rows })).toEqual(rows);
	});

	test("passes through a plain array (postgres-js/bun-sql shape)", () => {
		const rows = [{ id: 1 }];
		expect(rowsOf(rows)).toEqual(rows);
	});

	test("passes through an array subclass (SQLResultArray/RowList shape)", () => {
		class SQLResultArrayLike extends Array {
			command = "SELECT";
			count = 1;
		}
		const result = new SQLResultArrayLike();
		result.push({ id: 1 });

		const rows = rowsOf(result);
		expect(Array.isArray(rows)).toBe(true);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual({ id: 1 });
	});

	test("returns [] for undefined, null and rowless objects", () => {
		expect(rowsOf(undefined)).toEqual([]);
		expect(rowsOf(null)).toEqual([]);
		expect(rowsOf({})).toEqual([]);
		expect(rowsOf({ rows: "not-an-array" })).toEqual([]);
	});
});

describe("toKitDb", () => {
	test("wraps bare-array results (bun-sql shape) into { rows }", async () => {
		const fakeBunDb = {
			execute: async (_q: unknown) => [{ id: "a" }, { id: "b" }],
		};

		const kitDb = toKitDb(fakeBunDb);
		const result = await kitDb.execute("SELECT 1");

		expect(result).toEqual({ rows: [{ id: "a" }, { id: "b" }] });
	});

	test("passes through { rows } results (node-postgres shape) without double-wrap", async () => {
		const fakePgDb = {
			execute: async (_q: unknown) => ({ rows: [{ id: "a" }] }),
		};

		const kitDb = toKitDb(fakePgDb);
		const result = await kitDb.execute("SELECT 1");

		expect(result).toEqual({ rows: [{ id: "a" }] });
	});
});
