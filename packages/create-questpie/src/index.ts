#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Command } from "commander";

import { isModuleAllowed, modules as moduleRegistry } from "./modules.js";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffolder.js";
import { getTemplate } from "./templates.js";

/** Collect a repeatable `--module <name>` flag into an array. */
function collectModule(value: string, previous: string[]): string[] {
	return [...previous, value];
}

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
	.option("--runtime <id>", "Runtime to use (alias of --template)")
	.option(
		"--module <name>",
		"Module to enable (repeatable, e.g. --module admin --module openapi)",
		collectModule,
		[] as string[],
	)
	.option(
		"--modules <a,b,c>",
		"Comma-separated modules to enable (e.g. --modules admin,openapi)",
	)
	.option("-y, --yes", "Skip prompts and accept all defaults")
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
		"Realtime broker: none, pg-notify, redis-streams (default: none)",
	)
	.option("--kv <adapter>", "KV adapter: memory, redis (default: memory)")
	.option(
		"--continue-on-error",
		"Keep scaffold files when dependency install or codegen fails",
	)
	.action(async (projectName: string | undefined, opts) => {
		try {
			// --runtime is an alias of --template (id === template dir name).
			const templateId: string | undefined = opts.template ?? opts.runtime;

			// Validate template/runtime if provided.
			if (templateId && !getTemplate(templateId)) {
				throw new Error(
					`Unknown ${opts.runtime ? "runtime" : "template"}: ${templateId}`,
				);
			}

			// Merge `--module` (repeatable) + `--modules <a,b,c>` into one list.
			const requestedModules = [
				...((opts.module as string[]) ?? []),
				...(typeof opts.modules === "string"
					? opts.modules
							.split(",")
							.map((m: string) => m.trim())
							.filter(Boolean)
					: []),
			];

			// Front-loaded oracle validation: reject invalid module/runtime combos
			// with a single graceful line, BEFORE any prompt or file write. Reuses
			// the exact `isModuleAllowed` predicate the prompt filter uses.
			if (requestedModules.length > 0 && templateId) {
				for (const id of requestedModules) {
					const known = moduleRegistry.some((m) => m.id === id);
					if (!known) {
						throw new Error(
							`Unknown module: ${id}. Available: ${moduleRegistry.map((m) => m.id).join(", ")}.`,
						);
					}
					if (!isModuleAllowed(id, templateId)) {
						throw new Error(
							`Module "${id}" is not available for runtime "${templateId}".`,
						);
					}
				}
			}

			const options = await runPrompts({
				projectName,
				templateId,
				databaseName: opts.database,
				requestedModules:
					requestedModules.length > 0 ? requestedModules : undefined,
				fillDefaults: opts.yes === true,
				installDeps: opts.install === false ? false : undefined,
				initGit: opts.git === false ? false : undefined,
				installSkills: opts.skills === false ? false : undefined,
				runCodegen: opts.generate === false ? false : undefined,
				continueOnError: opts.continueOnError === true,
				queueAdapter: opts.queue,
				emailAdapter: opts.email,
				realtimeBroker: opts.realtime,
				kvAdapter: opts.kv,
			});

			await scaffold(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});

program.parse();
