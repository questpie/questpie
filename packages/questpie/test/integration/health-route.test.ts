import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { createPostgresSearchAdapter } from "../../src/server/modules/core/integrated/search/adapters/postgres.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Regression tests for the /health route search check.
 *
 * The route reads app.search.isInitialized() — a method that previously did
 * not exist on SearchServiceWrapper, so every app (including ones with the
 * default PostgresSearchAdapter) reported search "degraded" forever, even
 * though search worked.
 */

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

describe("/health route", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup.cleanup();
	});

	it("reports search ok on a default app once search is initialized", async () => {
		setup = await buildMockApp({ collections: { posts } });
		await runTestDbMigrations(setup.app);

		// Service creation kicks initialize() off without awaiting it —
		// await the idempotent call so the check below is deterministic.
		await setup.app.search.initialize();
		expect(setup.app.search.isInitialized()).toBe(true);

		const handler = createFetchHandler(setup.app);
		const response = await handler(new Request("http://localhost/health"));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.checks.search.status).toBe("ok");
		expect(body.status).toBe("ok");
	});

	it("reports search degraded when adapter initialization failed", async () => {
		const failingAdapter = createPostgresSearchAdapter();
		failingAdapter.initialize = async () => {
			throw new Error("search init failed");
		};

		setup = await buildMockApp(
			{ collections: { posts } },
			{ search: failingAdapter },
		);
		// No runTestDbMigrations here — it awaits search.initialize(), which
		// throws for this adapter. The health checks need no tables anyway.

		expect(setup.app.search.isInitialized()).toBe(false);

		const handler = createFetchHandler(setup.app);
		const response = await handler(new Request("http://localhost/health"));
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.checks.search.status).toBe("degraded");
		expect(body.status).toBe("degraded");
	});
});
