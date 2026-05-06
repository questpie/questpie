#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Command } from "commander";

import { addCommand } from "./commands/add.js";
import {
	cloudDeployCommand,
	cloudEnvImportCommand,
	cloudWhoamiCommand,
	getCloudErrorExitCode,
	cloudInitCommand,
	cloudLoginCommand,
	isSilentCloudError,
} from "./commands/cloud.js";
import { devCommand, generateCommand } from "./commands/codegen.js";
import { generateMigrationCommand } from "./commands/generate.js";
import { pushCommand } from "./commands/push.js";
import { runMigrationCommand } from "./commands/run.js";
import { runSeedCommand } from "./commands/seed.js";
import { parsePositiveIntegerOption } from "./utils.js";

const program = new Command();

function readPackageVersion(): string {
	for (const candidate of [
		resolve(import.meta.dirname, "..", "package.json"),
		resolve(import.meta.dirname, "..", "..", "package.json"),
		resolve(import.meta.dirname, "..", "..", "..", "package.json"),
	]) {
		if (!existsSync(candidate)) continue;
		const packageJson = JSON.parse(readFileSync(candidate, "utf-8")) as {
			version?: string;
		};
		if (packageJson.version) return packageJson.version;
	}
	return "0.0.0";
}

program
	.name("questpie")
	.description("QUESTPIE CLI")
	.version(readPackageVersion());

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

const cloud = program.command("cloud").description("Questpie Cloud commands");

function handleCloudCommandError(prefix: string, error: unknown) {
	if (!isSilentCloudError(error)) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`${prefix}: ${message}`);
	}
	process.exit(getCloudErrorExitCode(error));
}

cloud
	.command("login")
	.description("Log in to Questpie Cloud")
	.option("--cloud-url <url>", "Questpie Cloud base URL")
	.option("--token <token>", "Questpie Cloud API token")
	.option("--json", "Print machine-readable output")
	.action(async (options) => {
		try {
			await cloudLoginCommand({
				cloudUrl: options.cloudUrl,
				token: options.token,
				json: options.json,
			});
		} catch (error) {
			handleCloudCommandError("Failed to log in to Questpie Cloud", error);
		}
	});

cloud
	.command("whoami")
	.description("Show the active Questpie Cloud login")
	.option("--cloud-url <url>", "Questpie Cloud base URL")
	.option("--token <token>", "Questpie Cloud API token")
	.option("--json", "Print machine-readable output")
	.action(async (options) => {
		try {
			await cloudWhoamiCommand({
				cloudUrl: options.cloudUrl,
				token: options.token,
				json: options.json,
			});
		} catch (error) {
			handleCloudCommandError("Failed to read Questpie Cloud login", error);
		}
	});

cloud
	.command("init")
	.description("Initialize this project for Questpie Cloud")
	.option(
		"-c, --config <path>",
		"Path to questpie.cloud.toml",
		"questpie.cloud.toml",
	)
	.option("--cloud-url <url>", "Questpie Cloud base URL")
	.option("--token <token>", "Questpie Cloud API token")
	.option("--project <slug>", "Project slug")
	.option("--name <name>", "Project display name")
	.option("--environment <slug>", "Environment slug", "production")
	.option("--dockerfile <path>", "Dockerfile path")
	.option("--context <path>", "Build context", ".")
	.option("--service <name>", "Service name", "web")
	.option("--port <port>", "Service port", "3000")
	.option("--readiness <path>", "Readiness path", "/api/health")
	.option("--env-file <path>", "Import env vars after init")
	.option("--force", "Overwrite an existing config file")
	.option("--yes", "Confirm non-interactive changes")
	.option("--dry-run", "Validate without writing local or Cloud state")
	.option("--json", "Print machine-readable output")
	.option("--repo-url <url>", "Git repository URL override")
	.option("--branch <branch>", "Git branch override")
	.action(async (options) => {
		try {
			await cloudInitCommand({
				config: options.config,
				cloudUrl: options.cloudUrl,
				token: options.token,
				project: options.project,
				name: options.name,
				environment: options.environment,
				dockerfile: options.dockerfile,
				context: options.context,
				service: options.service,
				port: parsePositiveIntegerOption(options.port, "--port"),
				readiness: options.readiness,
				envFile: options.envFile,
				force: options.force,
				yes: options.yes,
				dryRun: options.dryRun,
				json: options.json,
				repoUrl: options.repoUrl,
				branch: options.branch,
			});
		} catch (error) {
			handleCloudCommandError("Failed to initialize Questpie Cloud", error);
		}
	});

const cloudEnv = cloud
	.command("env")
	.description("Questpie Cloud env commands");

cloudEnv
	.command("import <env-file>")
	.description("Import env vars for this project")
	.option(
		"-c, --config <path>",
		"Path to questpie.cloud.toml",
		"questpie.cloud.toml",
	)
	.option("--cloud-url <url>", "Questpie Cloud base URL")
	.option("--token <token>", "Questpie Cloud API token")
	.option("--service <name>", "Import vars for one service")
	.option("--dry-run", "Validate without changing Cloud state")
	.option("--json", "Print machine-readable output")
	.action(async (envFile, options) => {
		try {
			await cloudEnvImportCommand(envFile, {
				config: options.config,
				cloudUrl: options.cloudUrl,
				token: options.token,
				service: options.service,
				dryRun: options.dryRun,
				json: options.json,
			});
		} catch (error) {
			handleCloudCommandError(
				"Failed to import Questpie Cloud env vars",
				error,
			);
		}
	});

cloud
	.command("deploy")
	.description("Deploy a QUESTPIE project through Questpie Cloud")
	.option(
		"-c, --config <path>",
		"Path to questpie.cloud.toml",
		"questpie.cloud.toml",
	)
	.option("--cloud-url <url>", "Questpie Cloud base URL")
	.option("--dry-run", "Validate the deployment request without applying it")
	.option("--token <token>", "Questpie Cloud API token")
	.option("--follow", "Follow deployment progress")
	.option("--json", "Print machine-readable output")
	.option("--yes", "Confirm non-interactive deploy")
	.option("--timeout <seconds>", "Follow timeout in seconds", "900")
	.option("--poll-interval <seconds>", "Follow poll interval in seconds", "5")
	.option("--repo-url <url>", "Git repository URL override")
	.option("--repo-path <path>", "Local repository path override")
	.option("--branch <branch>", "Git branch override")
	.option("--commit <sha>", "Git commit SHA override")
	.action(async (options) => {
		try {
			await cloudDeployCommand({
				config: options.config,
				cloudUrl: options.cloudUrl,
				dryRun: options.dryRun,
				token: options.token,
				follow: options.follow,
				json: options.json,
				yes: options.yes,
				timeoutSeconds: parsePositiveIntegerOption(
					options.timeout,
					"--timeout",
				),
				pollIntervalSeconds: parsePositiveIntegerOption(
					options.pollInterval,
					"--poll-interval",
				),
				repoUrl: options.repoUrl,
				repoPath: options.repoPath,
				branch: options.branch,
				commit: options.commit,
			});
		} catch (error) {
			handleCloudCommandError("Failed to deploy through Questpie Cloud", error);
		}
	});

program.parse();
