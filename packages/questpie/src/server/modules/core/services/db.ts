import type {
	DbCreateResult,
	QuestpieConfig,
} from "#questpie/server/config/types.js";
import { service } from "#questpie/server/services/define-service.js";

function isWrappedDbCreateResult(
	value: unknown,
): value is Extract<DbCreateResult, { drizzle: unknown }> {
	return Boolean(value && typeof value === "object" && "drizzle" in value);
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
		// Widen to the general config union — this service must handle EVERY
		// DbConfig variant at runtime, while the generated `app.config.db` is
		// narrowed to the app's concrete shape (breaking the `in` guards below).
		const config = app.config as QuestpieConfig;
		const schema = app.getSchema();

		if ("drizzle" in config.db) {
			app._pgConnectionString = config.db.connectionString;
			app._dbCleanup = config.db.close;
			return config.db.drizzle;
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
				return created.drizzle;
			}

			return created;
		}

		if ("url" in config.db) {
			const [{ SQL }, { drizzle: drizzleBun }] = await Promise.all([
				import("bun"),
				import("drizzle-orm/bun-sql"),
			]);

			const bunSqlClient = new SQL({ url: config.db.url });
			app._pgConnectionString = config.db.url;
			app._dbCleanup = () => bunSqlClient.close({ timeout: 5 });
			return drizzleBun({ client: bunSqlClient, schema });
		}

		const { drizzle: drizzlePgLite } = await import("drizzle-orm/pglite");

		return drizzlePgLite({ client: config.db.pglite as any, schema });
	},
	dispose: () => {
		// Driver cleanup is handled by the app-level _dbCleanup callback because
		// dispose only receives the drizzle instance, not the raw driver/client.
	},
});
