import { describe, expect, it } from "bun:test";

import { channel } from "../../src/server/channels/channel-builder.js";
import { createApp } from "../../src/server/config/create-app.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

describe("createApp — channels wiring", () => {
	it("merges module and app channels into first-class QuestpieConfig", async () => {
		const moduleOnly = channel("module-only").events({});
		const moduleShared = channel("module-shared").events({});
		const appShared = channel("app-shared").events({});
		const appOnly = channel("app-only").events({});
		const db = await createTestDb();

		try {
			const app = await createApp(
				{
					modules: [
						{
							name: "channels-module",
							channels: { moduleOnly, shared: moduleShared },
						},
					],
					channels: { shared: appShared, appOnly },
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

			expect(app.config.channels).toEqual({
				moduleOnly,
				shared: appShared,
				appOnly,
			});
			expect(app.state?.channels).toBeUndefined();

			await app.destroy();
		} finally {
			await db.close();
		}
	});
});
