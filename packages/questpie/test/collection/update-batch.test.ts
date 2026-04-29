import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const rankedItems = collection("ranked_items")
	.fields(({ f }) => ({
		title: f.text().required(),
		sortOrder: f.number().required(),
	}))
	.options({ timestamps: true, versioning: true });

describe("collection updateBatch", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				rankedItems,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("updates distinct data per record and preserves input order", async () => {
		const ctx = createTestContext();
		const first = await setup.app.collections.rankedItems.create(
			{ title: "First", sortOrder: 10 },
			ctx,
		);
		const second = await setup.app.collections.rankedItems.create(
			{ title: "Second", sortOrder: 20 },
			ctx,
		);

		const updated = await setup.app.collections.rankedItems.updateBatch(
			{
				updates: [
					{ id: second.id, data: { sortOrder: 10 } },
					{ id: first.id, data: { sortOrder: 20, title: "Moved" } },
				],
			},
			ctx,
		);

		expect(updated.map((item) => item.id)).toEqual([second.id, first.id]);
		expect(updated[0].sortOrder).toBe(10);
		expect(updated[1].sortOrder).toBe(20);
		expect(updated[1].title).toBe("Moved");
	});

	it("rolls back all updates when one record update fails", async () => {
		const ctx = createTestContext();
		const first = await setup.app.collections.rankedItems.create(
			{ title: "First", sortOrder: 10 },
			ctx,
		);

		await expect(
			setup.app.collections.rankedItems.updateBatch(
				{
					updates: [
						{ id: first.id, data: { sortOrder: 99 } },
						{ id: "missing-record", data: { sortOrder: 1 } },
					],
				},
				ctx,
			),
		).rejects.toThrow("Record not found");

		const unchanged = await setup.app.collections.rankedItems.findOne(
			{ where: { id: first.id } },
			ctx,
		);
		expect(unchanged?.sortOrder).toBe(10);
	});
});
