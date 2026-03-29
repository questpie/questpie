import { SQL } from "bun";
import { drizzle as drizzleBun } from "drizzle-orm/bun-sql";
import { drizzle as drizzlePgLite } from "drizzle-orm/pglite";

import { service } from "#questpie/server/services/define-service.js";

/**
 * Database service — creates the Drizzle client from app config.
 *
 * Namespace: null (top-level in AppContext as `db`).
 * This is the sole init path for the database connection.
 */
export default service({
	namespace: null,
	lifecycle: "singleton",
	create: ({ app }) => {
		const config = app.config;
		const schema = app.getSchema();

		if ("url" in config.db) {
			// Postgres via Bun SQL
			const bunSqlClient = new SQL({ url: config.db.url });
			// Store on app for cleanup in dispose and for realtime/migrations
			app._sqlClient = bunSqlClient;
			app._pgConnectionString = config.db.url;
			return drizzleBun({ client: bunSqlClient, schema });
		}

		// PGlite for testing
		return drizzlePgLite({ client: config.db.pglite, schema });
	},
	dispose: () => {
		// SQL client disposal is handled by the app's _sqlClient reference
		// because dispose only receives the drizzle instance, not the raw SQL client.
		// The app.destroy() method handles _sqlClient.close() directly.
	},
});
