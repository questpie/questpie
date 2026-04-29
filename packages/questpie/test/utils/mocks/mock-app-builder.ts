import type { DriveManager } from "flydrive";

import { Questpie, createApp, module } from "../../../src/exports/index.js";
import type {
	ModuleDefinition,
	RuntimeConfig,
} from "../../../src/server/config/module-types.js";
import { createTestDb } from "../test-db";
import { MockKVAdapter } from "./kv.adapter";
import { MockLogger } from "./logger.adapter";
import { MockMailAdapter } from "./mailer.adapter";
import { MockQueueAdapter } from "./queue.adapter";

export type MockApp<TApp = any> = TApp & {
	/**
	 * Mock adapters for inspecting test state
	 */
	mocks: {
		kv: MockKVAdapter;
		queue: MockQueueAdapter;
		mailer: MockMailAdapter;
		logger: MockLogger;
		fakes: ReturnType<DriveManager<any>["fake"]>;
	};
};

/**
 * Builds a mock app instance from a module definition for testing.
 *
 * @example
 * ```ts
 * import { collection } from "questpie";
 *
 * const products = collection("products").fields(({ f }) => ({
 *   name: f.text().required(),
 *   price: f.number().required(),
 * }));
 *
 * const { cleanup, app } = await buildMockApp({
 *   collections: { products },
 * });
 *
 * // Use app normally
 * await app.collections.products.create({ name: "Widget", price: 9.99 });
 *
 * // Inspect mock state
 * expect(app.mocks.mailer.getSentCount()).toBe(0);
 * expect(app.mocks.queue.getJobs()).toHaveLength(0);
 *
 * await cleanup();
 * ```
 */
export async function buildMockApp(
	definition: Omit<ModuleDefinition, "name"> & { name?: string },
	runtimeOverrides: Partial<RuntimeConfig> = {},
): Promise<{
	cleanup: () => Promise<void>;
	app: MockApp<any>;
}> {
	const mailerAdapter = new MockMailAdapter();
	const queueAdapter = new MockQueueAdapter();
	const kvAdapter = new MockKVAdapter();
	const logger = new MockLogger();

	const usesCustomDb = Boolean(runtimeOverrides.db);
	const testDb = usesCustomDb ? null : await createTestDb();
	const dbConfig = runtimeOverrides.db ?? { pglite: testDb };

	// Normalize module definition — move flat config keys into config bucket
	const { locale, hooks, defaultAccess, auth, config: existingConfig, ...moduleDef } = definition as any;

	// Build config bucket from flat keys + any existing config
	const appConfigPart: Record<string, unknown> = {};
	if (locale) appConfigPart.locale = locale;
	if (hooks) appConfigPart.hooks = hooks;
	if (defaultAccess) appConfigPart.access = defaultAccess;

	const moduleConfig: Record<string, unknown> = { ...(existingConfig ?? {}) };
	if (Object.keys(appConfigPart).length > 0) {
		moduleConfig.app = { ...(moduleConfig.app as any ?? {}), ...appConfigPart };
	}
	if (auth) {
		moduleConfig.auth = auth;
	}

	const normalizedDef = module({
		name: "test",
		...moduleDef,
		...(Object.keys(moduleConfig).length > 0 ? { config: moduleConfig } : {}),
	});

	const app = await createApp(
		{ modules: [normalizedDef] },
		{
			app: runtimeOverrides.app ?? { url: "http://localhost:3000" },
			db: dbConfig,
			storage: runtimeOverrides.storage,
			email: {
				...(runtimeOverrides.email ?? {}),
				adapter: mailerAdapter,
			},
			kv: {
				...(runtimeOverrides.kv ?? {}),
				adapter: kvAdapter,
			},
			queue: {
				...(runtimeOverrides.queue ?? {}),
				adapter: queueAdapter,
			},
			logger: {
				...(runtimeOverrides.logger ?? {}),
				adapter: logger,
			},
			search: runtimeOverrides.search,
			realtime: runtimeOverrides.realtime,
			secret: runtimeOverrides.secret,
		} as RuntimeConfig,
	);

	// Attach mock adapters for easy access in tests
	const mockApp = app as MockApp<any>;
	mockApp.mocks = {
		kv: kvAdapter,
		queue: queueAdapter,
		mailer: mailerAdapter,
		logger: logger,
		fakes: app.storage.fake(Questpie.__internal.storageDriverServiceName),
	};

	const cleanup = async () => {
		if (testDb) {
			await testDb.close();
		}
		mockApp.storage.restore(Questpie.__internal.storageDriverServiceName);
	};

	return { cleanup, app: mockApp };
}
