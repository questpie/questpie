#!/usr/bin/env node

import { Command } from "commander";

import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffolder.js";
import { getTemplate } from "./templates.js";

const program = new Command()
	.name("create-questpie")
	.description("Create a new QUESTPIE project")
	.version("2.0.1")
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
			});

			await scaffold(options);
		} catch (error) {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		}
	});

program.parse();
