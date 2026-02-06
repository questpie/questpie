#!/usr/bin/env bun

import { Command } from "commander";
import { generateMigrationCommand } from "./commands/generate.js";
import { pushCommand } from "./commands/push.js";
import { runMigrationCommand } from "./commands/run.js";

const program = new Command();

program.name("questpie").description("QUESTPIE CLI").version("1.0.0");

// Generate migration command
program
  .command("migrate:generate")
  .description("Generate a new migration")
  .option(
    "-c, --config <path>",
    "Path to CMS config file",
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
  .description("Run pending migrations")
  .option(
    "-c, --config <path>",
    "Path to CMS config file",
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
    "Path to CMS config file",
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
        batch: options.batch ? Number.parseInt(options.batch, 10) : undefined,
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
    "Path to CMS config file",
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
    "Path to CMS config file",
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
    "Path to CMS config file",
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
    "Path to CMS config file",
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

program.parse();
