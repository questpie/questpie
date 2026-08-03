import { describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { createAppForRuntime } from "../types/__fullapp__/.generated/app-factory.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

const testInfrastructure = () => ({
	email: { adapter: new MockMailAdapter() },
	queue: { adapter: new MockQueueAdapter() },
	kv: { adapter: new MockKVAdapter() },
	logger: { adapter: new MockLogger() },
});

describe("generated app factory", () => {
	it("creates independently destroyable apps bound to different PGlite databases", async () => {
		const firstDb = await createTestDb();
		const secondDb = await createTestDb();
		let firstApp: Awaited<ReturnType<typeof createAppForRuntime>> | undefined;
		let secondApp: Awaited<ReturnType<typeof createAppForRuntime>> | undefined;

		try {
			firstApp = await createAppForRuntime({
				app: { url: "http://first.example.test" },
				db: { pglite: firstDb },
				...testInfrastructure(),
			});
			secondApp = await createAppForRuntime({
				app: { url: "http://second.example.test" },
				db: { pglite: secondDb },
				...testInfrastructure(),
			});

			expect(firstApp).not.toBe(secondApp);

			await firstApp.db.execute(
				sql`CREATE TABLE factory_probe (value text NOT NULL)`,
			);
			await secondApp.db.execute(
				sql`CREATE TABLE factory_probe (value text NOT NULL)`,
			);
			await firstApp.db.execute(
				sql`INSERT INTO factory_probe (value) VALUES ('first')`,
			);
			await secondApp.db.execute(
				sql`INSERT INTO factory_probe (value) VALUES ('second')`,
			);

			const firstResult = await firstApp.db.execute(
				sql`SELECT value FROM factory_probe`,
			);
			const secondResult = await secondApp.db.execute(
				sql`SELECT value FROM factory_probe`,
			);

			expect(firstResult.rows).toEqual([{ value: "first" }]);
			expect(secondResult.rows).toEqual([{ value: "second" }]);
		} finally {
			await Promise.allSettled([firstApp?.destroy(), secondApp?.destroy()]);
			await Promise.allSettled([firstDb.close(), secondDb.close()]);
		}
	});
});
