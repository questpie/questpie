#!/usr/bin/env node

import { Command } from "commander";
import { runPrompts } from "./prompts.js";
import { scaffold } from "./scaffolder.js";
import { getTemplate } from "./templates.js";

const program = new Command()
	.name("create-questpie")
	.description("Create a new QUESTPIE project")
	.version("0.1.0")
	.argument("[project-name]", "Name of the project")
	.option("-t, --template <name>", "Template to use (default: tanstack-start)")
	.option("--no-install", "Skip dependency installation")
	.option("--no-git", "Skip git initialization")
	.action(async (projectName: string | undefined, opts) => {
		// Validate template if provided
		if (opts.template && !getTemplate(opts.template)) {
			console.error(`Unknown template: ${opts.template}`);
			process.exit(1);
		}

		const options = await runPrompts({
			projectName,
			templateId: opts.template,
			installDeps: opts.install === false ? false : undefined,
			initGit: opts.git === false ? false : undefined,
		});

		await scaffold(options);
	});

program.parse();
