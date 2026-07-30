import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/server/config/create-app.js";
import {
	noopMeter,
	noopTracer,
	type ObservabilityAdapter,
} from "../../src/server/modules/core/integrated/observability/types.js";
import { MockKVAdapter } from "../utils/mocks/kv.adapter.js";
import { MockLogger } from "../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../utils/mocks/queue.adapter.js";
import { createTestDb } from "../utils/test-db.js";

/**
 * The adapter contract says `shutdown()` must flush, and that a process exiting
 * without it loses whatever is still batched. `Questpie.destroy()` only calls
 * services that declare `dispose` - it `continue`s past the rest - so the
 * observability service definition has to declare one or an OTLP exporter drops
 * its final batch on every clean shutdown.
 */
describe("observability service", () => {
	it("flushes the adapter when the app is destroyed", async () => {
		const db = await createTestDb();
		let shutdownCalls = 0;

		const adapter: ObservabilityAdapter = {
			tracer: () => noopTracer,
			meter: () => noopMeter,
			shutdown: async () => {
				shutdownCalls += 1;
			},
		};

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
					observability: { adapter },
				},
			);

			// Touch it so the singleton is actually instantiated; destroy() skips
			// services that were never resolved.
			expect(app.observability).toBeDefined();
			expect(shutdownCalls).toBe(0);

			await app.destroy();

			expect(shutdownCalls).toBe(1);
		} finally {
			await db.close();
		}
	});
});
