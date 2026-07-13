import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/server/config/create-app.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

describe("runtime config extensions", () => {
	it("forwards plugin-owned runtime keys to app.state", async () => {
		const db = await createTestDb();
		try {
			const app = await createApp(
				{ modules: [] },
				{
					app: { url: "http://localhost:3000" },
					db: { pglite: db },
					email: { adapter: new MockMailAdapter() },
					queue: { adapter: new MockQueueAdapter() },
					kv: { adapter: new MockKVAdapter() },
					logger: { adapter: new MockLogger() },
					contractExtension: { enabled: true },
				},
			);

			expect(app.state?.contractExtension).toEqual({ enabled: true });
			await app.destroy();
		} finally {
			await db.close();
		}
	});
});
