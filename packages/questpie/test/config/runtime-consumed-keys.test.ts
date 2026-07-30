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
 * Every RuntimeConfig key that create-app reads must be listed in
 * RUNTIME_CONSUMED_KEYS. A key that is read but unlisted is classified as an
 * unknown plugin extension and copied into `instance.state`, where two things
 * go wrong: it becomes a ghost duplicate of infrastructure config that nothing
 * reads, and `buildExtensionState` duck-types `.build()` one level into every
 * extension record — so a config member that happens to expose `build()` is
 * silently replaced by its return value.
 *
 * This is the same defect class as the `observability` key that was dropped
 * entirely before 30c15987; that one lost the value, this one duplicates it
 * into a bucket plugins read.
 */
describe("createApp — RuntimeConfig keys do not leak into state", () => {
	it("keeps consumed infra keys out of instance.state and leaves them intact", async () => {
		const db = await createTestDb();

		// A valid ObservabilityAdapter that also happens to expose build().
		// Nothing in the contract forbids it, and buildExtensionState would call
		// it and swap the adapter for the string.
		const adapterWithBuild: ObservabilityAdapter & { build: () => string } = {
			build: () => "MANGLED",
			tracer: () => noopTracer,
			meter: () => noopMeter,
			shutdown: async () => {},
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
					observability: { adapter: adapterWithBuild },
					// A stand-in, not a real executor adapter — this key only has
					// to reach create-app to show whether it leaks into state.
					executor: { trusted: { kind: "fake-trusted" } as never },
					crdt: { namespace: "test", engines: {} },
				},
			);

			try {
				// No ghost copies in the plugin-extension bucket.
				expect(app.state?.observability).toBeUndefined();
				expect(app.state?.executor).toBeUndefined();
				expect(app.state?.crdt).toBeUndefined();

				// And the real config still holds the adapter itself, not the
				// result of having had build() called on it.
				expect(app.config.observability?.adapter).toBe(adapterWithBuild);
			} finally {
				await app.destroy();
			}
		} finally {
			await db.close();
		}
	});
});
