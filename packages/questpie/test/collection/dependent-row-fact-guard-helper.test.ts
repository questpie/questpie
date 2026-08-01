import { describe, expect, it } from "bun:test";

import { getTableUniqueName } from "drizzle-orm";
import { pgSchema, text, type PgTable } from "drizzle-orm/pg-core";

import { createDependentRowLocker } from "../../src/server/collection/crud/shared/dependent-row-fact-guard.js";
import { createTestContext } from "../utils/test-context";

function makeCollection(table: PgTable, name: string, calls: string[]) {
	return {
		"~internalRelatedTable": table,
		"~internalReadCanonicalRows": async (ids: readonly (string | number)[]) =>
			ids.map((id) => ({ id })),
		lockMany: async ({ ids }: { ids: readonly (string | number)[] }) => {
			calls.push(`${name}:${typeof ids[0]}:${String(ids[0])}`);
			return ids;
		},
	};
}

function makeTx(physicalCalls: string[]) {
	return {
		select: () => ({
			from: (table: PgTable) => ({
				where: (condition: { queryChunks?: unknown[] }) => {
					const parameter = condition.queryChunks?.find(
						(chunk): chunk is { value: string | number } =>
							Boolean(
								chunk &&
								typeof chunk === "object" &&
								"value" in chunk &&
								(typeof chunk.value === "string" ||
									typeof chunk.value === "number"),
							),
					);
					return {
						for: async () => {
							if (!parameter) return [];
							physicalCalls.push(
								`${getTableUniqueName(table)}:${typeof parameter.value}:${String(parameter.value)}`,
							);
							return [{ id: parameter.value }];
						},
						then: (resolve: (rows: unknown[]) => void) => resolve([]),
					};
				},
			}),
		}),
	};
}

describe("dependent-row fact guard lock normalization", () => {
	it("orders physical tables, primary-key columns, and type-tagged ids independently of request order", async () => {
		const calls: string[] = [];
		const physicalCalls: string[] = [];
		const firstTable = pgSchema("alpha").table("targets", {
			id: text("alpha_pk").primaryKey(),
		});
		const secondTable = pgSchema("omega").table("targets", {
			id: text("omega_pk").primaryKey(),
		});
		const lock = createDependentRowLocker({
			collections: {
				second: makeCollection(secondTable, "second", calls),
				firstAlias: makeCollection(firstTable, "firstAlias", calls),
				first: makeCollection(firstTable, "first", calls),
			} as any,
			context: createTestContext(),
			tx: makeTx(physicalCalls),
		});

		await lock([
			{ collection: "second", ids: ["2", 10, "1"] },
			{ collection: "firstAlias", ids: ["2", 10, "1"] },
			{ collection: "first", ids: ["2", 10, "1"] },
		]);

		expect(physicalCalls).toEqual([
			"alpha.targets:number:10",
			"alpha.targets:string:1",
			"alpha.targets:string:2",
			"omega.targets:number:10",
			"omega.targets:string:1",
			"omega.targets:string:2",
		]);
		expect(calls).toEqual([
			"first:number:10",
			"first:string:1",
			"first:string:2",
			"firstAlias:number:10",
			"firstAlias:string:1",
			"firstAlias:string:2",
			"second:number:10",
			"second:string:1",
			"second:string:2",
		]);
	});

	it("allows one bounded request set per hook chain", async () => {
		const table = pgSchema("public_guard_test").table("targets", {
			id: text("id").primaryKey(),
		});
		const lock = createDependentRowLocker({
			collections: { targets: makeCollection(table, "targets", []) } as any,
			context: createTestContext(),
			tx: makeTx([]),
		});

		await expect(
			lock([
				{
					collection: "targets",
					ids: Array.from({ length: 101 }, (_, i) => `${i}`),
				},
			]),
		).rejects.toThrow("at most 100 unique ids");
		await expect(lock([])).rejects.toThrow("one request set");
	});
});
