import type { DriveManager } from "flydrive";
import {
  Questpie,
  type QuestpieBuilder,
  type QuestpieRuntimeConfig,
} from "../../../src/exports/index.js";
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
 * Builds a fully type-safe mock app instance from a Questpie builder for testing
 *
 * @example
 * ```ts
 * // Define test module with collections
 * const testModule = questpie({ name: 'test' })
 *   .collections({
 *     products: productsCollection,
 *     categories: categoriesCollection,
 *   })
 *   .jobs({
 *     sendEmail: sendEmailJob,
 *   });
 *
 * // Create test database
 * const db = await createTestDb();
 *
 * // Build mock app
 * const app = buildMockApp(testModule, {
 *   db: { pglite: db },
 *   app: { url: 'http://localhost:3000' },
 *   secret: 'test-secret',
 * });
 *
 * await runTestDbMigrations(app);
 *
 * // Use app normally
 * await app.api.collections.products.create({ ... }, context);
 *
 * // Inspect mock state
 * expect(app.mocks.logger.hasErrors()).toBe(false);
 * expect(app.mocks.queue.getJobs()).toHaveLength(1);
 * expect(app.mocks.mailer.getSentCount()).toBe(1);
 * ```
 */
export async function buildMockApp<TBuilder extends QuestpieBuilder<any>>(
  builder: TBuilder,
  runtimeOverrides: Partial<QuestpieRuntimeConfig> = {},
): Promise<{
  cleanup: () => Promise<void>;
  app: MockApp<TBuilder["$inferApp"]>;
}> {
  const mailerAdapter = new MockMailAdapter();
  const queueAdapter = new MockQueueAdapter();
  const kvAdapter = new MockKVAdapter();
  const logger = new MockLogger();

  const usesCustomDb = Boolean(runtimeOverrides.db);
  const testDb = usesCustomDb ? null : await createTestDb();
  const dbConfig = runtimeOverrides.db ?? { pglite: testDb };

  // Build app using builder pattern
  const app = builder.build({
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
    defaultAccess: runtimeOverrides.defaultAccess,
  } as QuestpieRuntimeConfig);

  // Attach mock adapters for easy access in tests
  const mockApp = app as MockApp<TBuilder["$inferApp"]>;
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
