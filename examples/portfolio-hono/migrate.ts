/**
 * Migration Runner
 *
 * Runs database migrations.
 * Usage: bun run migrate.ts
 */

import { cms } from "./src/cms";

async function migrate() {
	console.log("Running migrations...\n");

	try {
		await cms.migrate();
		console.log("\nMigrations completed successfully!");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}

	process.exit(0);
}

migrate();
