import { existsSync } from "node:fs";

import { loadQuestpieConfig } from "../config.js";
import { resolveCliPath } from "../utils.js";

export type PushOptions = {
	configPath: string;
	force?: boolean;
	verbose?: boolean;
};

/**
 * Push schema directly to database (dev only)
 *
 * This command:
 * 1. Loads the config
 * 2. Gets the current schema via app.getSchema()
 * 3. Uses drizzle-kit push API to sync schema to database
 *
 * WARNING: This is for development only! Use migrations for production.
 */
export async function pushCommand(options: PushOptions): Promise<void> {
	console.log("🚀 Pushing schema to database...\n");

	if (!options.force) {
		console.log("⚠️  WARNING: This will modify your database schema directly!");
		console.log("   Use migrations for production deployments.\n");
		console.log("   Use --force to skip this warning.\n");
	}

	// Resolve config path
	const resolvedConfigPath = resolveCliPath(options.configPath);

	if (!existsSync(resolvedConfigPath)) {
		throw new Error(`Config file not found: ${resolvedConfigPath}`);
	}

	// Load config
	const cmsConfig = await loadQuestpieConfig(resolvedConfigPath);
	const app = cmsConfig.app;

	// Get schema from app
	const schema = app.getSchema();
	console.log(
		`📊 Loaded schema with ${Object.keys(schema).length} definitions`,
	);

	// Import drizzle-kit push API
	const { pushSchema } = await import("drizzle-kit/api-postgres");

	console.log("⏳ Analyzing schema changes...\n");

	try {
		// Use drizzle-kit push API
		// pushSchema(imports, drizzleInstance, casing?, entitiesConfig?)
		const result = await pushSchema(schema, app.db as any);

		if (result.sqlStatements.length === 0) {
			console.log("✅ Schema is already up to date!");
			return;
		}

		console.log(
			`📝 Found ${result.sqlStatements.length} statements to execute:`,
		);

		if (options.verbose) {
			for (const stmt of result.sqlStatements) {
				console.log(`   ${stmt}`);
			}
			console.log("");
		}

		// Show hints if any
		if (result.hints.length > 0) {
			console.log("\n⚠️  Hints:");
			for (const hint of result.hints) {
				console.log(`   - ${hint.hint}`);
				if (hint.statement) {
					console.log(`     Statement: ${hint.statement}`);
				}
			}
			console.log("");
		}

		// Execute statements
		console.log("⏳ Applying changes...");
		await result.apply();
		console.log("\n✅ Schema pushed successfully!");
	} catch (error: any) {
		if (error.message?.includes("is not a function")) {
			console.log("⚠️  drizzle-kit push API not available in this version");
			console.log(
				"   Please use migrations instead: bun questpie migrate:generate && bun questpie migrate:up",
			);
			return;
		}
		throw error;
	}
}
