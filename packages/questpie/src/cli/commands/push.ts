import { existsSync } from "node:fs";

import { toKitDb } from "../../server/db/driver-result.js";
import { loadQuestpieConfig } from "../config.js";
import { resolveCliPath } from "../utils.js";
import { assertPushStatementsSafe, computePushEntities } from "./push-scope.js";

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
	console.log(
		"⚠️  DEVELOPMENT ONLY: `questpie push` bypasses migration history.",
	);
	console.log(
		"   Never run it against production. Use `questpie migrate:create` and `questpie migrate` instead.\n",
	);

	if (!options.force) {
		console.log("   This will modify your development database directly.");
		console.log("   Use --force to acknowledge this warning.\n");
	}

	// Resolve config path
	const resolvedConfigPath = resolveCliPath(options.configPath);

	if (!existsSync(resolvedConfigPath)) {
		throw new Error(`Config file not found: ${resolvedConfigPath}`);
	}

	// Load config
	const cmsConfig = await loadQuestpieConfig(resolvedConfigPath);
	const app = cmsConfig.app;

	try {
		// Get schema from app
		const schema = app.getSchema();
		console.log(
			`📊 Loaded schema with ${Object.keys(schema).length} definitions`,
		);

		// Import drizzle-kit push API
		const { pushSchema } = await import("drizzle-kit/api-postgres");

		if (typeof pushSchema !== "function") {
			console.log("⚠️  drizzle-kit push API not available in this version");
			console.log(
				"   Please use migrations instead: bun questpie migrate:generate && bun questpie migrate:up",
			);
			return;
		}

		console.log("⏳ Analyzing schema changes...\n");

		// Use drizzle-kit push API
		// pushSchema(imports, drizzleInstance, casing?, entitiesConfig?)
		// drizzle-kit assumes node-postgres result shape (`execute().rows`);
		// toKitDb normalizes driver-native results (bun-sql/postgres-js return
		// bare arrays) so push works against any configured driver.
		// Diff scope: only the app's schemas, never the migration ledger or
		// adapter-owned schemas (pg-boss) — see push-scope.ts for the incident
		// this guards against.
		const entities = computePushEntities(schema);
		const entitiesConfig: Parameters<typeof pushSchema>[3] = {
			schemas: entities.schemas,
			tables: entities.tables,
			entities: undefined,
			// drizzle-kit's only supported extensionsFilters value is "postgis" —
			// it teaches push to ignore PostGIS-owned tables (spatial_ref_sys etc.)
			// during the diff. Harmless no-op when PostGIS is unused (no such tables
			// → nothing filtered). https://orm.drizzle.team/docs/extensions/pg
			extensions: ["postgis"],
		};
		const result = await pushSchema(
			schema,
			toKitDb(app.db) as any,
			undefined,
			entitiesConfig,
		);

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

		// Belt-and-suspenders: refuse to execute anything that targets
		// framework/foreign state even if the diff filters drifted.
		assertPushStatementsSafe(result.sqlStatements, entities.schemas);

		// Execute statements
		console.log("⏳ Applying changes...");
		await result.apply();
		console.log("\n✅ Schema pushed successfully!");
	} finally {
		// Release adapter handles (db pool, search, queue, realtime, …) so the
		// CLI process can exit. `push` builds the full app but, unlike seed.ts,
		// never tore it down — so once any adapter keeps the event loop alive the
		// command hangs *after* a successful push. In a deploy that is fatal: the
		// init container (`questpie push --force`) never exits and the pod is
		// stuck in Init forever. Tearing the app down here lets the loop drain.
		await app.destroy();
	}
}
