import { describe, expect, it } from "bun:test";

import { getTableUniqueName } from "drizzle-orm";
import { pgSchema, text, type PgTable } from "drizzle-orm/pg-core";

import { lockDependentRows } from "../../src/server/collection/crud/shared/dependent-row-fact-guard.js";

const makeCollection = (table: PgTable) => ({
	"~internalRelatedTable": table,
});

function makeTx(physicalCalls: string[]) {
	return {
		select: () => ({
			from: (table: PgTable) => ({
				where: () => ({
					orderBy: () => ({
						for: async () => {
							physicalCalls.push(getTableUniqueName(table));
						},
					}),
				}),
			}),
		}),
	};
}

describe("dependent-row fact guard lock normalization", () => {
	it("coalesces aliases and locks each physical table once in deterministic order", async () => {
		const physicalCalls: string[] = [];
		const firstTable = pgSchema("alpha").table("targets", {
			id: text("alpha_pk").primaryKey(),
		});
		const secondTable = pgSchema("omega").table("targets", {
			id: text("omega_pk").primaryKey(),
		});

		await lockDependentRows({
			collections: {
				second: makeCollection(secondTable),
				firstAlias: makeCollection(firstTable),
				first: makeCollection(firstTable),
			},
			tx: makeTx(physicalCalls),
			requests: [
				{ collection: "second", ids: ["2", 10, "1"] },
				{ collection: "firstAlias", ids: ["2", 10, "1"] },
				{ collection: "first", ids: ["2", 10, "1"] },
			],
		});

		expect(physicalCalls).toEqual(["alpha.targets", "omega.targets"]);
	});

	it("rejects a plan above the bounded physical id limit", async () => {
		const table = pgSchema("public_guard_test").table("targets", {
			id: text("id").primaryKey(),
		});

		await expect(
			lockDependentRows({
				collections: { targets: makeCollection(table) },
				tx: makeTx([]),
				requests: [
					{
						collection: "targets",
						ids: Array.from({ length: 101 }, (_, index) => `${index}`),
					},
				],
			}),
		).rejects.toThrow("at most 100 unique dependent ids");
	});
});
