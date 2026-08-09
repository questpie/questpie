import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { stringOps } from "#questpie/server/fields/operators/builtin.js";
import { resolveContextualOperators } from "#questpie/server/fields/operators/resolve.js";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const articles = collection("articles").fields(({ f }) => ({
	title: f.text().required(),
	metadata: f.object({ author: f.text().required() }),
}));

describe("ordered string operators", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { articles } });
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("uses the database collation consistently for system-id cursors", async () => {
		const ctx = createTestContext();

		for (const id of ["A", "a", "aa", "z", "ä"]) {
			await setup.app.collections.articles.create(
				{ id, title: id, metadata: { author: id } },
				ctx,
			);
		}

		const ordered = await setup.app.collections.articles.find(
			{ orderBy: { id: "desc" } },
			ctx,
		);
		const expected = ordered.docs.map((doc) => doc.id);
		const seen: string[] = [];
		let cursor: string | undefined;

		for (;;) {
			const page = await setup.app.collections.articles.find(
				{
					where: cursor === undefined ? undefined : { id: { lt: cursor } },
					orderBy: { id: "desc" },
					limit: 1,
				},
				ctx,
			);

			const doc = page.docs[0];
			if (!doc) break;
			seen.push(doc.id);
			cursor = doc.id;
		}

		expect(seen).toEqual(expected);
	});

	it("executes strict and inclusive comparisons on a JSONB text path", async () => {
		const ctx = createTestContext();
		for (const author of ["Alice", "Bob", "Cara"]) {
			await setup.app.collections.articles.create(
				{
					id: author.toLowerCase(),
					title: author,
					metadata: { author },
				},
				ctx,
			);
		}

		const table = setup.app.collections.articles["~internalRelatedTable"];
		const operators = resolveContextualOperators(stringOps).jsonb;
		const path = { jsonbPath: ["author"] };
		const greaterThan = await setup.app.db
			.select({ id: table.id })
			.from(table)
			.where(operators.gt(table.metadata, "Bob", path));
		const atMost = await setup.app.db
			.select({ id: table.id })
			.from(table)
			.where(operators.lte(table.metadata, "Bob", path))
			.orderBy(table.id);

		expect(greaterThan.map(({ id }) => id)).toEqual(["cara"]);
		expect(atMost.map(({ id }) => id)).toEqual(["alice", "bob"]);
	});
});
