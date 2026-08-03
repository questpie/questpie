import { describe, expect, it } from "bun:test";

import * as createAppModule from "../../src/server/config/create-app.js";
import { createApp } from "../../src/server/config/create-app.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

/**
 * Merge strategies are core-owned. The JSDoc used to advertise
 * `MERGE_FNS.set("auditRules", mergeConcat)` and "plugin-declared strategies"
 * for config keys, and neither map has ever been exported. A plugin key gets
 * the generic duck-typed merge instead, and a plugin config key gets last-wins
 * on the whole object.
 *
 * These tests pin what a plugin author actually gets, so the promise cannot
 * come back into the docs without a test failing.
 */
describe("module merge strategies", () => {
	it("keeps the strategy tables out of the public surface", () => {
		// If either of these ever becomes reachable, the documented rule
		// ("core-owned, no registration") is no longer true.
		expect(createAppModule).not.toHaveProperty("MERGE_FNS");
		expect(createAppModule).not.toHaveProperty("CONFIG_KEY_MERGE");
	});

	it("merges an unlisted module key with the generic duck-typed rules", async () => {
		const db = await createTestDb();
		try {
			const app = await createApp(
				{
					modules: [
						{
							name: "audit-base",
							auditRules: ["base"],
							auditHandlers: { base: "base-handler" },
							auditVersion: 1,
						},
						{
							name: "audit-extra",
							auditRules: ["extra"],
							auditHandlers: { extra: "extra-handler" },
							auditVersion: 2,
						},
					],
				},
				{
					app: { url: "http://localhost:3000" },
					db: { pglite: db },
					email: { adapter: new MockMailAdapter() },
					queue: { adapter: new MockQueueAdapter() },
					kv: { adapter: new MockKVAdapter() },
					logger: { adapter: new MockLogger() },
				},
			);

			try {
				// Array + array concatenates. This is what the fake
				// `MERGE_FNS.set("auditRules", mergeConcat)` example promised,
				// and it is what you get without registering anything.
				expect(app.state?.auditRules).toEqual(["base", "extra"]);
				// Object + object spreads.
				expect(app.state?.auditHandlers).toEqual({
					base: "base-handler",
					extra: "extra-handler",
				});
				// Anything else: incoming wins.
				expect(app.state?.auditVersion).toBe(2);
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});

	it("replaces a plugin config key whole instead of merging below it", async () => {
		const db = await createTestDb();
		try {
			const app = await createApp(
				{
					modules: [
						{
							name: "webhooks-base",
							config: { webhooks: { secret: "base", retries: 3 } },
						},
						{
							name: "webhooks-override",
							config: { webhooks: { secret: "override" } },
						},
					],
				},
				{
					app: { url: "http://localhost:3000" },
					db: { pglite: db },
					email: { adapter: new MockMailAdapter() },
					queue: { adapter: new MockQueueAdapter() },
					kv: { adapter: new MockKVAdapter() },
					logger: { adapter: new MockLogger() },
				},
			);

			try {
				// `retries` is gone. Only app, auth and admin merge below the key,
				// so a plugin config key is last-wins on the whole object.
				const config = app.state?.config as Record<string, unknown>;
				expect(config.webhooks).toEqual({ secret: "override" });
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});
});
