import { describe, expect, it } from "bun:test";

import {
	optimisticActionInput,
	optimisticBatchEntry,
	optimisticIdInput,
	optimisticManyInput,
	optimisticUpdateInput,
	runAdminBulkDelete,
} from "#questpie/admin/client/utils/optimistic-lock";

const lock = { field: "revision", required: true } as const;

describe("admin optimistic-lock inputs", () => {
	it("keeps the version out of update data and carries it separately", () => {
		expect(
			optimisticUpdateInput("post-1", { title: "Updated", revision: 4 }, lock),
		).toEqual({
			id: "post-1",
			data: { title: "Updated" },
			expectedVersion: 4,
		});
		expect(
			optimisticIdInput("post-1", { id: "post-1", revision: 4 }, lock),
		).toEqual({ id: "post-1", expectedVersion: 4 });
	});

	it("builds exact per-record versions for batch and bulk calls", () => {
		const first = { id: "post-1", revision: 2 };
		const second = { id: "post-2", revision: 8 };

		expect(optimisticBatchEntry("post-1", { rank: 1 }, first, lock)).toEqual({
			id: "post-1",
			data: { rank: 1 },
			expectedVersion: 2,
		});
		expect(
			optimisticManyInput(["post-2", "post-1"], [first, second], lock),
		).toEqual({
			where: { id: { in: ["post-2", "post-1"] } },
			expectedVersions: [
				{ id: "post-2", expectedVersion: 8 },
				{ id: "post-1", expectedVersion: 2 },
			],
		});
		expect(optimisticActionInput(first, [first, second], lock)).toEqual({
			expectedVersion: 2,
			expectedVersions: [
				{ id: "post-1", expectedVersion: 2 },
				{ id: "post-2", expectedVersion: 8 },
			],
		});
	});

	it("preserves unconfigured mutation inputs", () => {
		expect(optimisticUpdateInput("post-1", { revision: 4 })).toEqual({
			id: "post-1",
			data: { revision: 4 },
		});
		expect(
			optimisticManyInput(["post-1"], [{ id: "post-1", revision: 4 }]),
		).toEqual({
			where: { id: { in: ["post-1"] } },
		});
		expect(
			optimisticActionInput({ id: "post-1", revision: 4 }, undefined),
		).toEqual({});
	});

	it("keeps unlocked bulk delete partially successful and uses atomic bulk only when locked", async () => {
		const individualCalls: string[] = [];
		const bulkCalls: unknown[] = [];
		const unlocked = await runAdminBulkDelete({
			ids: ["post-1", "post-2"],
			records: [
				{ id: "post-1", revision: 1 },
				{ id: "post-2", revision: 2 },
			],
			deleteById: async ({ id }) => {
				individualCalls.push(id);
				if (id === "post-2") throw new Error("denied");
				return { success: true };
			},
			deleteMany: async (input) => {
				bulkCalls.push(input);
			},
		});
		expect(unlocked?.map((result) => result.status)).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(individualCalls).toEqual(["post-1", "post-2"]);
		expect(bulkCalls).toEqual([]);

		const locked = await runAdminBulkDelete({
			ids: ["post-1", "post-2"],
			records: [
				{ id: "post-1", revision: 1 },
				{ id: "post-2", revision: 2 },
			],
			config: lock,
			deleteById: async ({ id }) => {
				individualCalls.push(id);
			},
			deleteMany: async (input) => {
				bulkCalls.push(input);
			},
		});
		expect(locked).toBeNull();
		expect(bulkCalls).toEqual([
			{
				where: { id: { in: ["post-1", "post-2"] } },
				expectedVersions: [
					{ id: "post-1", expectedVersion: 1 },
					{ id: "post-2", expectedVersion: 2 },
				],
			},
		]);
	});
});
