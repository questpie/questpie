import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const articles = collection("articles").fields(({ f }) => ({
	title: f.text().required(),
	metadata: f.object({
		author: f.text(),
		tag: f.text(),
	}),
}));

describe("JSONB operator security", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { articles } });
		await runTestDbMigrations(setup.app);

		const ctx = createTestContext();
		await setup.app.collections.articles.create(
			{
				id: crypto.randomUUID(),
				title: "Alice",
				metadata: { author: "Alice", tag: "safe" },
			},
			ctx,
		);
		await setup.app.collections.articles.create(
			{
				id: crypto.randomUUID(),
				title: "Bob",
				metadata: { author: "Bob", tag: "safe" },
			},
			ctx,
		);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("treats JSONB pathEquals path segments as values", async () => {
		const result = await setup.app.collections.articles.find(
			{
				where: {
					metadata: {
						pathEquals: {
							path: ["author'} = 'Alice' OR TRUE --"],
							val: "Alice",
						},
					},
				} as any,
			},
			createTestContext(),
		);

		expect(result.docs).toHaveLength(0);
	});

	it("treats JSONB key arrays as values", async () => {
		const result = await setup.app.collections.articles.find(
			{
				where: {
					metadata: {
						hasKeys: ["tag'] OR TRUE --"],
					},
				} as any,
			},
			createTestContext(),
		);

		expect(result.docs).toHaveLength(0);
	});
});
