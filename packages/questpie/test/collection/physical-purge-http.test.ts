import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const records = collection("purge_http_records")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ softDelete: true })
	.access({
		create: true,
		read: true,
		update: true,
		delete: true,
		purge: true,
	});

describe("physical purge HTTP contract", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup.cleanup();
	});

	it("exposes POST /:collection/:id/purge and physically removes a tombstone", async () => {
		setup = await buildMockApp({ collections: { records } });
		await runTestDbMigrations(setup.app);

		const ctx = createTestContext({ accessMode: "system" });
		const created = await setup.app.collections.records.create(
			{ title: "Expired" },
			ctx,
		);
		await setup.app.collections.records.deleteById({ id: created.id }, ctx);

		const handler = createFetchHandler(setup.app, {
			accessMode: "system",
		});
		const response = await handler(
			new Request(`http://localhost/records/${created.id}/purge`, {
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true });
		expect(
			await setup.app.db
				.select()
				.from(setup.app.collections.records["~internalRelatedTable"]),
		).toHaveLength(0);
	});
});
