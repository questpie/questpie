import { describe, expect, it } from "bun:test";

import {
	optimisticActionInput,
	optimisticBatchEntry,
	optimisticGlobalUpdateInput,
	optimisticIdInput,
	optimisticManyInput,
	transitionStageBody,
	optimisticUpdateInput,
	runAdminBulkDelete,
} from "#questpie/admin/client/utils/optimistic-concurrency";

const lock = true as const;

describe("admin optimistic-concurrency inputs", () => {
	it("keeps the revision out of update data and carries it separately", () => {
		expect(
			optimisticUpdateInput("post-1", { title: "Updated", revision: 4 }, lock),
		).toEqual({
			id: "post-1",
			data: { title: "Updated" },
			expectedRevision: 4,
		});
		expect(
			optimisticIdInput("post-1", { id: "post-1", revision: 4 }, lock),
		).toEqual({ id: "post-1", expectedRevision: 4 });
	});

	it("uses current form revisions for global saves and workflow transitions", () => {
		expect(
			optimisticGlobalUpdateInput({ title: "Second save", revision: 7 }, lock),
		).toEqual({
			data: { title: "Second save" },
			expectedRevision: 7,
		});
		expect(
			transitionStageBody({
				stage: "published",
				expectedRevision: 7,
				scheduledAt: new Date("2026-01-02T03:04:05.000Z"),
			}),
		).toEqual({
			stage: "published",
			expectedRevision: 7,
			scheduledAt: "2026-01-02T03:04:05.000Z",
		});
	});

	it("builds exact per-record revisions for batch and bulk calls", () => {
		const first = { id: "post-1", revision: 2 };
		const second = { id: "post-2", revision: 8 };

		expect(optimisticBatchEntry("post-1", { rank: 1 }, first, lock)).toEqual({
			id: "post-1",
			data: { rank: 1 },
			expectedRevision: 2,
		});
		expect(
			optimisticManyInput(["post-2", "post-1"], [first, second], lock),
		).toEqual({
			where: { id: { in: ["post-2", "post-1"] } },
			expectedRevisions: [
				{ id: "post-2", expectedRevision: 8 },
				{ id: "post-1", expectedRevision: 2 },
			],
		});
		expect(optimisticActionInput(first, [first, second], lock)).toEqual({
			expectedRevision: 2,
			expectedRevisions: [
				{ id: "post-1", expectedRevision: 2 },
				{ id: "post-2", expectedRevision: 8 },
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
				expectedRevisions: [
					{ id: "post-1", expectedRevision: 1 },
					{ id: "post-2", expectedRevision: 2 },
				],
			},
		]);
	});
});
