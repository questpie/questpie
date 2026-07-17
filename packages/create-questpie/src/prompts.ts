import * as p from "@clack/prompts";
import pc from "picocolors";

import {
	defaultModuleIds,
	isModuleAllowed,
	modules as moduleRegistry,
	type RuntimeId,
} from "./modules.js";
import { templates } from "./templates.js";
import { isValidPackageName, toDbName } from "./utils.js";

export const queueAdapters = ["pg-boss", "bullmq", "none"] as const;
export const emailAdapters = ["console", "smtp", "resend", "plunk"] as const;
export const realtimeBrokers = ["none", "pg-notify", "redis-streams"] as const;
export const kvAdapters = ["memory", "redis"] as const;

export type QueueAdapterOption = (typeof queueAdapters)[number];
export type EmailAdapterOption = (typeof emailAdapters)[number];
export type RealtimeBrokerOption = (typeof realtimeBrokers)[number];
export type KVAdapterOption = (typeof kvAdapters)[number];

export type ProjectOptions = {
	projectName: string;
	templateId: string;
	databaseName: string;
	modules: string[];
	installDeps: boolean;
	initGit: boolean;
	installSkills: boolean;
	runCodegen: boolean;
	continueOnError?: boolean;
	queueAdapter?: QueueAdapterOption;
	emailAdapter?: EmailAdapterOption;
	realtimeBroker?: RealtimeBrokerOption;
	kvAdapter?: KVAdapterOption;
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
		realtimeBroker: options.realtimeBroker ?? "none",
		kvAdapter: options.kvAdapter ?? "memory",
	};
}

/**
 * Resolve the module ids for a non-interactive run (flags / --yes). Explicit
 * `--module(s)` win; otherwise fall back to the runtime defaults. Every id is
 * validated through the same `isModuleAllowed` oracle the prompt filter uses,
 * so a flag combo cannot bypass the compatibility rule.
 */
function resolveModuleIds(
	runtime: string,
	requested: string[] | undefined,
): string[] {
	const allowed = moduleRegistry.filter((m) => isModuleAllowed(m.id, runtime));
	const allowedIds = new Set(allowed.map((m) => m.id));
	if (requested && requested.length > 0) {
		for (const id of requested) {
			if (!allowedIds.has(id)) {
				const known = moduleRegistry.some((m) => m.id === id);
				throw new Error(
					known
						? `Module "${id}" is not available for runtime "${runtime}".`
						: `Unknown module: ${id}. Expected one of: ${moduleRegistry
								.map((m) => m.id)
								.join(", ")}.`,
				);
			}
		}
		// Preserve registry order; de-dupe.
		const wanted = new Set(requested);
		return allowed.filter((m) => wanted.has(m.id)).map((m) => m.id);
	}
	return defaultModuleIds(runtime as RuntimeId).filter((id) =>
		allowedIds.has(id),
	);
}

export async function runPrompts(
	args: Partial<ProjectOptions> & {
		projectName?: string;
		/** Raw `--module(s)` selection (validated against the runtime oracle). */
		requestedModules?: string[];
		/** `--yes` / `-y`: skip prompts, fill every choice with its default. */
		fillDefaults?: boolean;
	},
): Promise<ProjectOptions> {
	const isInteractive =
		Boolean(process.stdin.isTTY && process.stdout.isTTY) && !args.fillDefaults;
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
	const realtimeBroker = assertChoice(
		"realtime broker",
		args.realtimeBroker,
		realtimeBrokers,
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

		const templateId = args.templateId ?? templates[0].id;
		return withOptionDefaults({
			projectName: args.projectName,
			templateId,
			databaseName: args.databaseName ?? toDbName(args.projectName),
			modules:
				args.modules ?? resolveModuleIds(templateId, args.requestedModules),
			installDeps: args.installDeps ?? true,
			initGit: args.initGit ?? true,
			installSkills: args.installSkills ?? true,
			runCodegen: args.runCodegen ?? true,
			continueOnError: args.continueOnError ?? false,
			queueAdapter,
			emailAdapter,
			realtimeBroker,
			kvAdapter,
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
					message: "Runtime",
					options: templates.map((t) => ({
						value: t.id,
						label: t.label,
						hint: t.hint,
					})),
				});
			},
			modules: ({ results }) => {
				const runtime = results.templateId as string;
				if (args.modules) return Promise.resolve(args.modules);
				if (args.requestedModules) {
					return Promise.resolve(
						resolveModuleIds(runtime, args.requestedModules),
					);
				}
				const available = moduleRegistry.filter((m) =>
					isModuleAllowed(m.id, runtime),
				);
				const defaults = new Set(defaultModuleIds(runtime as RuntimeId));
				return p.multiselect({
					message: "Modules",
					required: false,
					initialValues: available
						.filter((m) => defaults.has(m.id))
						.map((m) => m.id),
					options: available.map((m) => ({
						value: m.id,
						label: m.group ? `${m.group} · ${m.label}` : m.label,
						hint: m.hint,
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
		modules: questions.modules as string[],
		installDeps: questions.installDeps as boolean,
		initGit: questions.initGit as boolean,
		installSkills: questions.installSkills as boolean,
		runCodegen: questions.runCodegen as boolean,
		continueOnError: args.continueOnError ?? false,
		queueAdapter,
		emailAdapter,
		realtimeBroker,
		kvAdapter,
	});
}
