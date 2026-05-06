#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Command } from "commander";

import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffolder.js";
import { getTemplate } from "./templates.js";

function readPackageVersion(): string {
	for (const candidate of [
		resolve(import.meta.dirname, "..", "package.json"),
		resolve(import.meta.dirname, "..", "..", "package.json"),
	]) {
		if (!existsSync(candidate)) continue;
		const packageJson = JSON.parse(readFileSync(candidate, "utf-8")) as {
			version?: string;
		};
		if (packageJson.version) return packageJson.version;
	}
	return "0.0.0";
}

const program = new Command()
	.name("create-questpie")
	.description("Create a new QUESTPIE project")
	.version(readPackageVersion())
	.argument("[project-name]", "Name of the project")
	.option("-t, --template <name>", "Template to use (default: tanstack-start)")
	.option(
		"--database <name>",
		"Database name (default: derived from project name)",
	)
	.option("--no-install", "Skip dependency installation")
	.option("--no-git", "Skip git initialization")
	.option("--no-skills", "Skip installing project-local QUESTPIE agent skills")
	.option("--no-generate", "Skip running QUESTPIE codegen after install")
	.option(
		"--queue <adapter>",
		"Queue adapter: pg-boss, bullmq, none (default: pg-boss)",
	)
	.option(
		"--email <adapter>",
		"Email adapters to scaffold: console, smtp, resend, plunk (default: console)",
	)
	.option(
		"--realtime <adapter>",
		"Realtime adapter: none, pg-notify, redis-streams (default: none)",
	)
	.option("--kv <adapter>", "KV adapter: memory, redis (default: memory)")
	.option("--workflows", "Install and register @questpie/workflows")
	.option(
		"--continue-on-error",
		"Keep scaffold files when dependency install or codegen fails",
	)
	.action(async (projectName: string | undefined, opts) => {
		try {
			// Validate template if provided
			if (opts.template && !getTemplate(opts.template)) {
				throw new Error(`Unknown template: ${opts.template}`);
			}

			const options = await runPrompts({
				projectName,
				templateId: opts.template,
				databaseName: opts.database,
				installDeps: opts.install === false ? false : undefined,
				initGit: opts.git === false ? false : undefined,
				installSkills: opts.skills === false ? false : undefined,
				runCodegen: opts.generate === false ? false : undefined,
				continueOnError: opts.continueOnError === true,
				queueAdapter: opts.queue,
				emailAdapter: opts.email,
				realtimeAdapter: opts.realtime,
				kvAdapter: opts.kv,
				includeWorkflows: opts.workflows === true,
			});

			await scaffold(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});

program.parse();
