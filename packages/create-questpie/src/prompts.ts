import * as p from "@clack/prompts";
import pc from "picocolors";

import { templates } from "./templates.js";
import { isValidPackageName, toDbName } from "./utils.js";

export const queueAdapters = ["pg-boss", "bullmq", "none"] as const;
export const emailAdapters = ["console", "smtp", "resend", "plunk"] as const;
export const realtimeAdapters = ["none", "pg-notify", "redis-streams"] as const;
export const kvAdapters = ["memory", "redis"] as const;

export type QueueAdapterOption = (typeof queueAdapters)[number];
export type EmailAdapterOption = (typeof emailAdapters)[number];
export type RealtimeAdapterOption = (typeof realtimeAdapters)[number];
export type KVAdapterOption = (typeof kvAdapters)[number];

export type ProjectOptions = {
	projectName: string;
	templateId: string;
	databaseName: string;
	installDeps: boolean;
	initGit: boolean;
	installSkills: boolean;
	runCodegen: boolean;
	continueOnError?: boolean;
	queueAdapter?: QueueAdapterOption;
	emailAdapter?: EmailAdapterOption;
	realtimeAdapter?: RealtimeAdapterOption;
	kvAdapter?: KVAdapterOption;
	includeWorkflows?: boolean;
};

function assertChoice<T extends readonly string[]>(
	name: string,
	value: string | undefined,
	choices: T,
): T[number] | undefined {
	if (value === undefined) return undefined;
	if (choices.includes(value)) return value as T[number];
	throw new Error(
		`Invalid ${name}: ${value}. Expected one of: ${choices.join(", ")}.`,
	);
}

function withOptionDefaults(options: ProjectOptions): ProjectOptions {
	return {
		...options,
		queueAdapter: options.queueAdapter ?? "pg-boss",
		emailAdapter: options.emailAdapter ?? "console",
		realtimeAdapter: options.realtimeAdapter ?? "none",
		kvAdapter: options.kvAdapter ?? "memory",
		includeWorkflows: options.includeWorkflows ?? false,
	};
}

export async function runPrompts(
	args: Partial<ProjectOptions> & { projectName?: string },
): Promise<ProjectOptions> {
	const isInteractive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
	const queueAdapter = assertChoice(
		"queue adapter",
		args.queueAdapter,
		queueAdapters,
	);
	const emailAdapter = assertChoice(
		"email adapter",
		args.emailAdapter,
		emailAdapters,
	);
	const realtimeAdapter = assertChoice(
		"realtime adapter",
		args.realtimeAdapter,
		realtimeAdapters,
	);
	const kvAdapter = assertChoice("KV adapter", args.kvAdapter, kvAdapters);

	if (!isInteractive) {
		if (!args.projectName) {
			throw new Error("Project name is required in non-interactive mode.");
		}
		if (!isValidPackageName(args.projectName)) {
			throw new Error(
				"Invalid package name (use lowercase, hyphens, no spaces).",
			);
		}

		return withOptionDefaults({
			projectName: args.projectName,
			templateId: args.templateId ?? templates[0].id,
			databaseName: args.databaseName ?? toDbName(args.projectName),
			installDeps: args.installDeps ?? true,
			initGit: args.initGit ?? true,
			installSkills: args.installSkills ?? true,
			runCodegen: args.runCodegen ?? true,
			continueOnError: args.continueOnError ?? false,
			queueAdapter,
			emailAdapter,
			realtimeAdapter,
			kvAdapter,
			includeWorkflows: args.includeWorkflows ?? false,
		});
	}

	p.intro(pc.bgCyan(pc.black(" QUESTPIE — Create a new project ")));

	const questions = await p.group(
		{
			projectName: () => {
				if (args.projectName) {
					if (!isValidPackageName(args.projectName)) {
						throw new Error(
							"Invalid package name (use lowercase, hyphens, no spaces).",
						);
					}
					return Promise.resolve(args.projectName);
				}
				return p.text({
					message: "Project name",
					placeholder: "my-questpie-app",
					validate: (value) => {
						if (!value) return "Project name is required";
						if (!isValidPackageName(value))
							return "Invalid package name (use lowercase, hyphens, no spaces)";
					},
				});
			},
			templateId: () => {
				if (args.templateId) return Promise.resolve(args.templateId);
				if (templates.length === 1) return Promise.resolve(templates[0].id);
				return p.select({
					message: "Select a template",
					options: templates.map((t) => ({
						value: t.id,
						label: t.label,
						hint: t.hint,
					})),
				});
			},
			databaseName: ({ results }) => {
				if (args.databaseName) return Promise.resolve(args.databaseName);
				const defaultDb = toDbName(results.projectName as string);
				return p.text({
					message: "Database name",
					placeholder: defaultDb,
					defaultValue: defaultDb,
				});
			},
			installDeps: () => {
				if (args.installDeps !== undefined)
					return Promise.resolve(args.installDeps);
				return p.confirm({
					message: "Install dependencies?",
					initialValue: true,
				});
			},
			initGit: () => {
				if (args.initGit !== undefined) return Promise.resolve(args.initGit);
				return p.confirm({
					message: "Initialize git repository?",
					initialValue: true,
				});
			},
			installSkills: () => {
				if (args.installSkills !== undefined)
					return Promise.resolve(args.installSkills);
				return p.confirm({
					message: "Install QUESTPIE agent skills into the project?",
					initialValue: true,
				});
			},
			runCodegen: ({ results }) => {
				if (args.runCodegen !== undefined)
					return Promise.resolve(args.runCodegen);
				if (args.installDeps === false || results.installDeps === false) {
					return Promise.resolve(false);
				}
				return p.confirm({
					message: "Run QUESTPIE codegen after installing dependencies?",
					initialValue: true,
				});
			},
		},
		{
			onCancel: () => {
				p.cancel("Operation cancelled.");
				process.exit(0);
			},
		},
	);

	return withOptionDefaults({
		projectName: questions.projectName as string,
		templateId: questions.templateId as string,
		databaseName: questions.databaseName as string,
		installDeps: questions.installDeps as boolean,
		initGit: questions.initGit as boolean,
		installSkills: questions.installSkills as boolean,
		runCodegen: questions.runCodegen as boolean,
		continueOnError: args.continueOnError ?? false,
		queueAdapter,
		emailAdapter,
		realtimeAdapter,
		kvAdapter,
		includeWorkflows: args.includeWorkflows ?? false,
	});
}
