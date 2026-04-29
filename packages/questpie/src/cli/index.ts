#!/usr/bin/env bun

import { Command } from "commander";

import { addCommand } from "./commands/add.js";
import { devCommand, generateCommand } from "./commands/codegen.js";
import { generateMigrationCommand } from "./commands/generate.js";
import { pushCommand } from "./commands/push.js";
import { runMigrationCommand } from "./commands/run.js";
import { runSeedCommand } from "./commands/seed.js";
import { parsePositiveIntegerOption } from "./utils.js";

const program = new Command();

program.name("questpie").description("QUESTPIE CLI").version("1.0.0");

// Codegen: generate .generated/index.ts from file convention
program
	.command("generate")
	.description("Generate .generated/index.ts from file convention")
	.option(
		"-c, --config <path>",
		"Path to questpie.config.ts",
		"questpie.config.ts",
	)
	.option("--dry-run", "Show generated code without writing files")
	.option("--verbose", "Show verbose output")
	.action(async (options) => {
		try {
			await generateCommand({
				configPath: options.config,
				dryRun: options.dryRun,
				verbose: options.verbose,
			});
		} catch (error) {
			console.error("Failed to generate:", error);
			process.exit(1);
		}
	});

// Dev mode: watch and regenerate on file add/remove
program
	.command("dev")
	.description("Watch mode — regenerate .generated/index.ts on file changes")
	.option(
		"-c, --config <path>",
		"Path to questpie.config.ts",
		"questpie.config.ts",
	)
	.option("--verbose", "Show verbose output")
	.action(async (options) => {
		try {
			await devCommand({
				configPath: options.config,
				verbose: options.verbose,
			});
		} catch (error) {
			console.error("Dev mode error:", error);
			process.exit(1);
		}
	});

// Generate migration command
program
	.command("migrate:generate")
	.alias("migrate:create")
	.description("Generate a new migration")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("-n, --name <name>", "Custom migration name")
	.option("--dry-run", "Show what would be generated without creating files")
	.option("--verbose", "Show verbose output")
	.option(
		"--non-interactive",
		"Skip interactive prompts (auto-select defaults)",
	)
	.action(async (options) => {
		try {
			await generateMigrationCommand(options.config, {
				name: options.name,
				dryRun: options.dryRun,
				verbose: options.verbose,
				nonInteractive: options.nonInteractive,
			});
		} catch (error) {
			console.error("❌ Failed to generate migration:", error);
			process.exit(1);
		}
	});

// Run migrations (up)
program
	.command("migrate:up")
	.alias("migrate")
	.description("Run pending migrations")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("-t, --target <migration>", "Target specific migration ID")
	.option("--dry-run", "Show what would be run without executing")
	.action(async (options) => {
		try {
			await runMigrationCommand({
				action: "up",
				configPath: options.config,
				targetMigration: options.target,
				dryRun: options.dryRun,
			});
		} catch (error) {
			console.error("❌ Failed to run migrations:", error);
			process.exit(1);
		}
	});

// Rollback migrations (down)
program
	.command("migrate:down")
	.description("Rollback migrations")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("-b, --batch <number>", "Rollback specific batch number")
	.option("-t, --target <migration>", "Rollback to specific migration")
	.option("--dry-run", "Show what would be run without executing")
	.action(async (options) => {
		try {
			await runMigrationCommand({
				action: "down",
				configPath: options.config,
				batch: parsePositiveIntegerOption(options.batch, "--batch"),
				targetMigration: options.target,
				dryRun: options.dryRun,
			});
		} catch (error) {
			console.error("❌ Failed to rollback migrations:", error);
			process.exit(1);
		}
	});

// Migration status
program
	.command("migrate:status")
	.description("Show migration status")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.action(async (options) => {
		try {
			await runMigrationCommand({
				action: "status",
				configPath: options.config,
			});
		} catch (error) {
			console.error("❌ Failed to get migration status:", error);
			process.exit(1);
		}
	});

// Reset migrations
program
	.command("migrate:reset")
	.description("Rollback all migrations")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("--dry-run", "Show what would be run without executing")
	.action(async (options) => {
		try {
			await runMigrationCommand({
				action: "reset",
				configPath: options.config,
				dryRun: options.dryRun,
			});
		} catch (error) {
			console.error("❌ Failed to reset migrations:", error);
			process.exit(1);
		}
	});

// Fresh migrations (reset + run all)
program
	.command("migrate:fresh")
	.description("Reset and run all migrations")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("--dry-run", "Show what would be run without executing")
	.action(async (options) => {
		try {
			await runMigrationCommand({
				action: "fresh",
				configPath: options.config,
				dryRun: options.dryRun,
			});
		} catch (error) {
			console.error("❌ Failed to fresh migrations:", error);
			process.exit(1);
		}
	});

// Push schema (dev only - like drizzle-kit push)
program
	.command("push")
	.description("Push schema directly to database (dev only)")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("-f, --force", "Skip warning prompt")
	.option("-v, --verbose", "Show SQL statements")
	.action(async (options) => {
		try {
			await pushCommand({
				configPath: options.config,
				force: options.force,
				verbose: options.verbose,
			});
		} catch (error) {
			console.error("❌ Failed to push schema:", error);
			process.exit(1);
		}
	});

// Run seeds
program
	.command("seed")
	.description("Run pending seeds")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option(
		"--category <categories>",
		"Filter by category (comma-separated: required,dev,test)",
	)
	.option("--only <ids>", "Run specific seeds by ID (comma-separated)")
	.option("-f, --force", "Force re-run even if already executed")
	.option("--validate", "Dry-run: validate seeds without persisting data")
	.action(async (options) => {
		try {
			await runSeedCommand({
				action: "run",
				configPath: options.config,
				category: options.category,
				only: options.only,
				force: options.force,
				validate: options.validate,
			});
		} catch (error) {
			console.error("❌ Failed to run seeds:", error);
			process.exit(1);
		}
	});

// Undo seeds
program
	.command("seed:undo")
	.description("Undo executed seeds")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option(
		"--category <categories>",
		"Filter by category (comma-separated: required,dev,test)",
	)
	.option("--only <ids>", "Undo specific seeds by ID (comma-separated)")
	.action(async (options) => {
		try {
			await runSeedCommand({
				action: "undo",
				configPath: options.config,
				category: options.category,
				only: options.only,
			});
		} catch (error) {
			console.error("❌ Failed to undo seeds:", error);
			process.exit(1);
		}
	});

// Seed status
program
	.command("seed:status")
	.description("Show seed status")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.action(async (options) => {
		try {
			await runSeedCommand({
				action: "status",
				configPath: options.config,
			});
		} catch (error) {
			console.error("❌ Failed to get seed status:", error);
			process.exit(1);
		}
	});

// Reset seed tracking
program
	.command("seed:reset")
	.description("Reset seed tracking (does NOT undo data)")
	.option(
		"-c, --config <path>",
		"Path to app config file",
		"questpie.config.ts",
	)
	.option("--only <ids>", "Reset tracking for specific seeds (comma-separated)")
	.action(async (options) => {
		try {
			await runSeedCommand({
				action: "reset",
				configPath: options.config,
				only: options.only,
			});
		} catch (error) {
			console.error("❌ Failed to reset seed tracking:", error);
			process.exit(1);
		}
	});

// Scaffold entity files
program
	.command("add [type] [name]")
	.description(
		"Scaffold new entity files (run with --list to see available types)",
	)
	.option(
		"-c, --config <path>",
		"Path to questpie.config.ts",
		"questpie.config.ts",
	)
	.option("--dry-run", "Show what would be created without writing files")
	.option("--list", "List all available scaffold types")
	.option("--target <target>", "Restrict scaffold to a specific codegen target")
	.action(async (type, name, options) => {
		try {
			await addCommand({
				type,
				name,
				configPath: options.config,
				dryRun: options.dryRun,
				list: options.list,
				target: options.target,
			});
		} catch (error) {
			console.error("❌ Failed to add entity:", error);
			process.exit(1);
		}
	});

program.parse();
