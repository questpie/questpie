import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import {
	DrizzleMigrationGenerator,
	type GenerateMigrationOptions,
} from "../../server/migration/generator.js";
import { loadQuestpieConfig } from "../config.js";
import { resolveCliPath } from "../utils.js";
import { resolveEntityRoot } from "./codegen.js";

/**
 * Mock stdin to automatically answer interactive prompts with Enter (select default)
 * Returns a restore function to revert stdin back to original
 */
function mockStdinForNonInteractive(): () => void {
	const originalStdin = process.stdin;
	const originalIsTTY = process.stdin.isTTY;
	const originalSetRawMode = (process.stdin as any).setRawMode;

	const buffer = "";
	let promptCount = 0;

	// Create a readable stream that provides Enter keypresses on demand
	const mockStream = new Readable({
		read() {
			// Auto-answer with Enter after a short delay
			setTimeout(() => {
				promptCount++;
				// Send Enter key (carriage return)
				this.push("\r");
				this.push("\n");
			}, 100);
		},
	}) as any;

	mockStream.isTTY = true;
	mockStream.setRawMode = (mode: boolean) => {
		return mockStream;
	};

	// Also intercept key events if using readline
	mockStream.on = function (event: string, listener: any) {
		if (event === "keypress") {
			// Auto-trigger keypress with Enter
			setTimeout(() => listener("\r", { name: "return", sequence: "\r" }), 50);
		}
		return Readable.prototype.on.call(this, event, listener);
	};

	// Override stdin
	(process as any).stdin = mockStream;

	// Return restore function
	return () => {
		(process as any).stdin = originalStdin;
		process.stdin.isTTY = originalIsTTY;
		if (originalSetRawMode) {
			(process.stdin as any).setRawMode = originalSetRawMode;
		}
		console.log(
			`\n✅ Auto-answered ${promptCount} prompts in non-interactive mode`,
		);
	};
}

/**
 * Generate a new migration
 *
 * This command:
 * 1. Loads the config
 * 2. Gets the current schema via app.getSchema()
 * 3. Builds cumulative snapshot from migrations loaded via .migrations([...])
 * 4. Generates migration file with embedded snapshot
 * 5. Saves to cli.migrations.directory
 */
export async function generateMigrationCommand(
	configPath: string,
	options: GenerateMigrationOptions = {},
): Promise<void> {
	console.log("📝 Generating migration...\n");

	// Handle non-interactive mode by auto-answering prompts
	let stdinRestore: (() => void) | undefined;
	if (options.nonInteractive) {
		console.log(
			"🤖 Running in non-interactive mode (auto-selecting defaults)\n",
		);
		stdinRestore = mockStdinForNonInteractive();
	}

	try {
		await generateMigrationInternal(configPath, options);
	} finally {
		// Restore stdin if it was mocked
		if (stdinRestore) {
			stdinRestore();
		}
	}
}

async function generateMigrationInternal(
	configPath: string,
	options: GenerateMigrationOptions = {},
): Promise<void> {
	// Resolve config path
	const resolvedConfigPath = resolveCliPath(configPath);

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

	// Get migrations from app config
	// Supports both flat array (new codegen) and legacy nested format { migrations: [...] }
	const existingMigrations =
		(Array.isArray(app.config.migrations)
			? app.config.migrations
			: app.config.migrations?.migrations) ?? [];
	console.log(`📦 Found ${existingMigrations.length} existing migrations`);

	// Get migration directory: explicit cli override or convention-based default (entity root)
	const { rootDir } = await resolveEntityRoot(resolvedConfigPath);
	const migrationDir = cmsConfig.cli?.migrations?.directory
		? resolveCliPath(cmsConfig.cli.migrations.directory)
		: join(rootDir, "migrations");

	// Create migration directory if needed
	if (!existsSync(migrationDir)) {
		mkdirSync(migrationDir, { recursive: true });
	}

	// Generate timestamp and name
	const timestamp = new Date()
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\..+/, "")
		.slice(0, 15); // YYYYMMDDTHHmmss

	// Generate random name if not provided
	const randomName = options.name || generateRandomName();

	// New format: timestamp_random_name
	const fileBaseName = `${timestamp}_${randomName}`;

	// Convert to camelCase with timestamp at end for variable name
	const camelCaseName = toCamelCase(randomName);
	const migrationVariableName = `${camelCaseName}${timestamp}`;

	console.log(`📝 Migration name: ${fileBaseName}`);
	console.log(`🔤 Variable name: ${migrationVariableName}`);
	console.log(`📁 Directory: ${migrationDir}\n`);

	if (options.dryRun) {
		console.log("🔍 DRY RUN - Would generate migration with the above details");
		return;
	}

	// Generate migration using DrizzleMigrationGenerator
	const generator = new DrizzleMigrationGenerator();

	// Build cumulative snapshot from existing migrations' embedded snapshots
	const cumulativeSnapshot =
		generator.getCumulativeSnapshotFromMigrations(existingMigrations);

	const result = await generator.generateMigration({
		migrationName: migrationVariableName,
		fileBaseName,
		schema,
		migrationDir,
		cumulativeSnapshot,
	});

	if (result.skipped) {
		console.log(
			"⏭️  No schema changes detected, skipping migration generation",
		);
		return;
	}

	console.log("\n✅ Migration generated successfully!");
	console.log(`\nNext steps:`);
	console.log(
		`  1. Review the migration file: ${migrationDir}/${fileBaseName}.ts`,
	);
	console.log(`  2. Run questpie generate to update .generated/index.ts`);
	console.log(`  3. Run migrations: bun questpie migrate:up`);
}

function generateRandomName(): string {
	const adjectives = [
		"happy",
		"bright",
		"swift",
		"bold",
		"calm",
		"eager",
		"fancy",
		"gentle",
		"jolly",
		"kind",
	];
	const colors = [
		"red",
		"blue",
		"green",
		"yellow",
		"purple",
		"orange",
		"pink",
		"crimson",
		"azure",
		"emerald",
	];
	const animals = [
		"zebra",
		"panda",
		"tiger",
		"eagle",
		"dolphin",
		"falcon",
		"phoenix",
		"dragon",
		"griffin",
		"unicorn",
	];

	const randomItem = (arr: string[]) =>
		arr[Math.floor(Math.random() * arr.length)]!;

	return `${randomItem(adjectives)}_${randomItem(colors)}_${randomItem(animals)}`;
}

function toCamelCase(str: string): string {
	return str
		.replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
		.replace(/^(.)/, (char) => char.toLowerCase());
}
