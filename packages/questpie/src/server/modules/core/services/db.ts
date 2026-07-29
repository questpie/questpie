import type {
	DbCreateResult,
	QuestpieConfig,
} from "#questpie/server/config/types.js";
import { instrumentDbClient } from "#questpie/server/db/instrument.js";
import { assertSupportedPostgresVersion } from "#questpie/server/db/postgres-version.js";
import { service } from "#questpie/server/services/define-service.js";

function isWrappedDbCreateResult(
	value: unknown,
): value is Extract<DbCreateResult, { drizzle: unknown }> {
	return Boolean(value && typeof value === "object" && "drizzle" in value);
}

type VersionQueryableDb = {
	execute(query: unknown): Promise<unknown>;
};

function isVersionQueryableDb(value: unknown): value is VersionQueryableDb {
	return Boolean(
		value &&
		typeof value === "object" &&
		"execute" in value &&
		typeof value.execute === "function",
	);
}

async function acceptCustomDb<T>(db: T): Promise<T> {
	// Real Drizzle PostgreSQL clients expose execute(), so enforce the baseline
	// when the custom client is queryable. Opaque adapters keep their existing
	// initialization contract; migration execution performs the same preflight.
	if (isVersionQueryableDb(db)) await assertSupportedPostgresVersion(db);
	return db;
}

/**
 * Database service — creates the Drizzle client from app config.
 *
 * Namespace: null (top-level in AppContext as `db`).
 * This is the sole init path for the database connection.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: async ({ app }) => {
		// Query spans are attached to EVERY config variant, including the two
		// where the user hands us a fully built client — see db/instrument.ts for
		// why the seam is the Drizzle session rather than the driver. No-op when
		// no observability adapter is configured.
		const instrument = <T>(db: T): T =>
			instrumentDbClient(db, app.observability);
		// Widen to the general config union — this service must handle EVERY
		// DbConfig variant at runtime, while the generated `app.config.db` is
		// narrowed to the app's concrete shape (breaking the `in` guards below).
		const config = app.config as QuestpieConfig;
		const schema = app.getSchema();
		if ("drizzle" in config.db) {
			app._pgConnectionString = config.db.connectionString;
			app._dbCleanup = config.db.close;
			return instrument(await acceptCustomDb(config.db.drizzle));
		}

		if ("create" in config.db) {
			const created = await config.db.create({ schema });
			if (!created) {
				throw new Error(
					"[questpie] db.create() must return a Drizzle client or { drizzle, close? }.",
				);
			}

			if (isWrappedDbCreateResult(created)) {
				app._pgConnectionString = created.connectionString;
				app._dbCleanup = created.close;
				return instrument(await acceptCustomDb(created.drizzle));
			}

			return instrument(await acceptCustomDb(created));
		}

		const accept = async <
			T extends { execute(query: unknown): Promise<unknown> },
		>(
			db: T,
		): Promise<T> => {
			await assertSupportedPostgresVersion(db);
			return db;
		};

		if ("url" in config.db) {
			app._pgConnectionString = config.db.url;

			// Optional pool tuning (see DbPoolConfig). questpie's config is in ms;
			// each driver gets its native unit. Omitted keys keep driver defaults.
			const pool = config.db.pool;
			const msToSec = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

			// Pick the Postgres driver by runtime so a single `db.url` config runs
			// on BOTH Bun and Node: Bun → the native zero-dep `bun:sql` client;
			// Node (e.g. Next.js's server runtime) → `node-postgres` via the
			// optional `pg` peer dependency. Bun servers keep the bun-sql path.
			if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
				const [{ SQL }, { drizzle: drizzleBun }] = await Promise.all([
					import("bun"),
					import("drizzle-orm/bun-sql"),
				]);

				// Bun's SQL takes all timeouts in SECONDS.
				const bunSqlClient = new SQL({
					url: config.db.url,
					...(pool?.max !== undefined ? { max: pool.max } : {}),
					...(pool?.connectionTimeoutMs !== undefined
						? { connectionTimeout: msToSec(pool.connectionTimeoutMs) }
						: {}),
					...(pool?.idleTimeoutMs !== undefined
						? { idleTimeout: msToSec(pool.idleTimeoutMs) }
						: {}),
					...(pool?.maxLifetimeMs !== undefined
						? { maxLifetime: msToSec(pool.maxLifetimeMs) }
						: {}),
					...(pool?.prepare !== undefined ? { prepare: pool.prepare } : {}),
				});
				app._dbCleanup = () => bunSqlClient.close({ timeout: 5 });
				return instrument(
					await accept(drizzleBun({ client: bunSqlClient, schema })),
				);
			}

			const [{ default: pg }, { drizzle: drizzlePg }] = await Promise.all([
				import("pg"),
				import("drizzle-orm/node-postgres"),
			]);

			// node-postgres takes acquire/idle timeouts in MILLISECONDS and
			// connection lifetime in SECONDS. `prepare` has no pool-level knob (it
			// only creates named statements when a query sets `name`), so it is
			// intentionally not mapped here.
			const pgPool = new pg.Pool({
				connectionString: config.db.url,
				...(pool?.max !== undefined ? { max: pool.max } : {}),
				...(pool?.connectionTimeoutMs !== undefined
					? { connectionTimeoutMillis: pool.connectionTimeoutMs }
					: {}),
				...(pool?.idleTimeoutMs !== undefined
					? { idleTimeoutMillis: pool.idleTimeoutMs }
					: {}),
				...(pool?.maxLifetimeMs !== undefined
					? { maxLifetimeSeconds: msToSec(pool.maxLifetimeMs) }
					: {}),
			});
			app._dbCleanup = () => pgPool.end();
			return instrument(await accept(drizzlePg({ client: pgPool, schema })));
		}

		const { drizzle: drizzlePgLite } = await import("drizzle-orm/pglite");

		return instrument(
			await accept(drizzlePgLite({ client: config.db.pglite as any, schema })),
		);
	},
	dispose: () => {
		// Driver cleanup is handled by the app-level _dbCleanup callback because
		// dispose only receives the drizzle instance, not the raw driver/client.
	},
});
