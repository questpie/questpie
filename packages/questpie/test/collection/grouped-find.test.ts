import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const groupedPosts = collection("grouped_posts")
	.fields(({ f }) => ({
		title: f.text().required(),
		status: f
			.select([
				{ value: "draft", label: "Draft" },
				{ value: "published", label: "Published" },
				{ value: "archived", label: "Archived" },
			])
			.required(),
	}))
	.options({ timestamps: true });

describe("collection grouped find", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				groupedPosts,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("paginates groups and returns full counts for each selected group", async () => {
		const ctx = createTestContext();
		await setup.app.collections.groupedPosts.create(
			{ title: "Draft A", status: "draft" },
			ctx,
		);
		await setup.app.collections.groupedPosts.create(
			{ title: "Draft B", status: "draft" },
			ctx,
		);
		await setup.app.collections.groupedPosts.create(
			{ title: "Published A", status: "published" },
			ctx,
		);
		await setup.app.collections.groupedPosts.create(
			{ title: "Published B", status: "published" },
			ctx,
		);
		await setup.app.collections.groupedPosts.create(
			{ title: "Archived A", status: "archived" },
			ctx,
		);

		const firstPage = await setup.app.collections.groupedPosts.find(
			{
				groupBy: { field: "status", order: "asc" },
				limit: 2,
				offset: 0,
				orderBy: { title: "asc" },
			},
			ctx,
		);

		expect(firstPage.totalDocs).toBe(5);
		expect(firstPage.totalGroups).toBe(3);
		expect(firstPage.totalPages).toBe(2);
		expect(firstPage.groups?.map((group) => group.value)).toEqual([
			"archived",
			"draft",
		]);
		expect(firstPage.groups?.map((group) => group.count)).toEqual([1, 2]);
		expect(firstPage.docs.map((doc) => doc.status)).toEqual([
			"archived",
			"draft",
			"draft",
		]);

		const secondPage = await setup.app.collections.groupedPosts.find(
			{
				groupBy: { field: "status", order: "asc" },
				limit: 2,
				offset: 2,
				orderBy: { title: "asc" },
			},
			ctx,
		);

		expect(secondPage.groups?.map((group) => group.value)).toEqual([
			"published",
		]);
		expect(secondPage.groups?.[0]?.count).toBe(2);
		expect(secondPage.docs.map((doc) => doc.status)).toEqual([
			"published",
			"published",
		]);
	});
});
