import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import * as p from "@clack/prompts";

import { type ModuleDefinition, modules } from "./modules.js";
import type { ProjectOptions } from "./prompts.js";
import { getSkillsInstallArgs } from "./skills.js";
import {
	detectPackageManager,
	generatePassword,
	gitInit,
	installDependencies,
	isGitInstalled,
	label,
	runPackageScript,
} from "./utils.js";

const TEMPLATE_VAR_REGEX = /\{\{(\w+)\}\}/g;

/**
 * Central pinned dependency versions. One place to bump every package the
 * scaffolder can add. Module deps reference these keys too — `depVersion`
 * resolves a package name to its pinned version (falling back to the version
 * declared on the module entry, then "latest").
 */
const dependencyVersionMap: Record<string, string> = {
	"@questpie/admin": "latest",
	"@questpie/mcp": "latest",
	"@questpie/openapi": "latest",
	"@questpie/workflows": "latest",
	"better-auth": "^1.6.11",
	bullmq: "^5.0.0",
	redis: "^5.0.0",
};

function depVersion(name: string, fallback = "latest"): string {
	return dependencyVersionMap[name] ?? fallback;
}

/** Stable de-duplication preserving first-seen order. */
function dedupe(lines: string[]): string[] {
	return Array.from(new Set(lines));
}

/**
 * Adapter feature registry — declarative description of every adapter toggle
 * (queue / email / realtime / kv). Each selectable option captures the data
 * the generators need: extra deps, env vars, the runtime-config import line,
 * and the runtime-config entry block. The generators iterate the SELECTED
 * options instead of branching on adapter ids.
 *
 * `email` is intentionally NOT modelled here: its config entry is a ternary
 * expression keyed off `MAIL_ADAPTER` and its env enum is derived from the
 * selection, so it keeps its dedicated builders (`buildEnvFile` /
 * `buildEmailAdapterExpression`).
 */
type FeatureDescriptor = {
	/** Extra dependencies (name -> version). Deduped across options. */
	deps?: Record<string, string>;
	/** Extra env-var schema lines for `src/lib/env.ts`. Deduped across options. */
	envVars?: string[];
	/** Import lines for `questpie.config.ts`. Deduped across options. */
	configImports?: string[];
	/** Helper function block emitted above the config (already includes trailing blank line). */
	configHelper?: string[];
	/** Config entry block (lines) appended into `runtimeConfig({...})`. */
	configEntry?: (options: ProjectOptions) => string[];
};

const REDIS_URL_ENV = `\t\tREDIS_URL: z.string().url().default("redis://localhost:6379"),`;

const features: Record<string, Record<string, FeatureDescriptor>> = {
	queue: {
		"pg-boss": {
			configImports: [
				`import { pgBossAdapter } from "questpie/adapters/pg-boss";`,
			],
			configEntry: () => [
				`\tqueue: {`,
				`\t\tadapter: pgBossAdapter({ connectionString: env.DATABASE_URL }),`,
				`\t},`,
			],
		},
		bullmq: {
			deps: { bullmq: depVersion("bullmq"), redis: depVersion("redis") },
			envVars: [REDIS_URL_ENV],
			configImports: [
				`import { bullMQAdapter } from "questpie/adapters/bullmq";`,
			],
			configEntry: () => [
				`\tqueue: {`,
				`\t\tadapter: bullMQAdapter({ connection: { url: env.REDIS_URL } }),`,
				`\t},`,
			],
		},
		none: {},
	},
	realtime: {
		none: {},
		"pg-notify": {
			configImports: [
				`import { pgNotifyChangeBroker } from "questpie/adapters/pg-notify";`,
			],
			configEntry: () => [
				`\trealtime: {`,
				`\t\tchangeBroker: pgNotifyChangeBroker({ connectionString: env.DATABASE_URL }),`,
				`\t},`,
			],
		},
		"redis-streams": {
			deps: { redis: depVersion("redis") },
			envVars: [REDIS_URL_ENV],
			configImports: [
				`import { redisStreamsChangeBroker } from "questpie/adapters/redis-streams";`,
				`import { createClient } from "redis";`,
			],
			configHelper: [
				`const realtimeRedis = createClient({ url: env.REDIS_URL });`,
				`await realtimeRedis.connect();`,
				``,
			],
			configEntry: () => [
				`\trealtime: {`,
				`\t\tchangeBroker: redisStreamsChangeBroker({ client: realtimeRedis }),`,
				`\t},`,
			],
		},
	},
	kv: {
		memory: {},
		redis: {
			deps: { redis: depVersion("redis") },
			envVars: [REDIS_URL_ENV],
			configImports: [
				`import { redisKVAdapter } from "questpie/adapters/redis-kv";`,
				`import { createClient } from "redis";`,
			],
			configHelper: [
				`async function getRedis() {`,
				`\tconst redis = createClient({ url: env.REDIS_URL });`,
				`\tawait redis.connect();`,
				`\treturn redis;`,
				`}`,
				``,
			],
			configEntry: (options) => [
				`\tkv: {`,
				`\t\tadapter: redisKVAdapter({ client: getRedis, keyPrefix: "${options.projectName}:" }),`,
				`\t},`,
			],
		},
	},
};

/** The adapter selection for each feature axis, with the same defaults the generators assume. */
function selectedFeatureOptions(
	options: ProjectOptions,
): { axis: string; option: string }[] {
	return [
		{ axis: "queue", option: options.queueAdapter ?? "pg-boss" },
		{ axis: "realtime", option: options.realtimeBroker ?? "none" },
		{ axis: "kv", option: options.kvAdapter ?? "memory" },
	];
}

/** Resolve the selected feature descriptors (skips unknown/missing entries). */
function selectedFeatures(options: ProjectOptions): FeatureDescriptor[] {
	return selectedFeatureOptions(options)
		.map(({ axis, option }) => features[axis]?.[option])
		.filter((f): f is FeatureDescriptor => Boolean(f));
}

/**
 * The modules selected for this project. The selection is resolved upstream
 * (prompts / flags, validated through the `isModuleAllowed` oracle) and threaded
 * through `options.modules`; here we just project it onto registry entries,
 * preserving registry order.
 */
function selectedModules(options: ProjectOptions): ModuleDefinition[] {
	const ids = new Set(options.modules);
	return modules.filter((m) => ids.has(m.id));
}

/**
 * Resolves the path to the templates directory.
 * Works both in dev (src/) and built (dist/) contexts.
 */
function getTemplatesDir(): string {
	// In published package, templates/ is sibling to dist/
	const fromDist = resolve(import.meta.dirname, "..", "templates");
	if (existsSync(fromDist)) return fromDist;
	// Fallback: relative from src during dev
	const fromSrc = resolve(import.meta.dirname, "..", "..", "templates");
	if (existsSync(fromSrc)) return fromSrc;
	throw new Error("Could not find templates directory");
}

type TemplateVars = {
	projectName: string;
	databaseName: string;
	databaseUser: string;
	databasePassword: string;
	authSecret: string;
};

const TEXT_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".json",
	".md",
	".css",
	".html",
	".yml",
	".yaml",
	".toml",
	".env",
	".example",
	".hbs",
	"",
]);

function isTextFile(filename: string): boolean {
	const ext = filename.slice(filename.lastIndexOf("."));
	// dotfiles like .gitignore, .env.example
	if (filename.startsWith(".")) return true;
	return TEXT_EXTENSIONS.has(ext);
}

async function replaceInFile(
	filePath: string,
	vars: TemplateVars,
): Promise<void> {
	const content = (await readFile(filePath)).toString("utf-8");
	const replaced = content.replace(TEMPLATE_VAR_REGEX, (match, key) => {
		return key in vars ? vars[key as keyof TemplateVars] : match;
	});
	if (replaced !== content) {
		await writeFile(filePath, replaced, "utf-8");
	}
}

async function processDirectory(
	dir: string,
	vars: TemplateVars,
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			await processDirectory(fullPath, vars);
		} else if (entry.isFile() && isTextFile(entry.name)) {
			await replaceInFile(fullPath, vars);
		}
	}
}

async function renameGitignore(targetDir: string): Promise<void> {
	const gitignorePath = join(targetDir, "gitignore");
	if (existsSync(gitignorePath)) {
		await rename(gitignorePath, join(targetDir, ".gitignore"));
	}
}

async function renameEnvExample(targetDir: string): Promise<void> {
	const envPath = join(targetDir, "env.example");
	if (existsSync(envPath)) {
		await rename(envPath, join(targetDir, ".env.example"));
	}
}

async function createLocalEnv(targetDir: string): Promise<void> {
	const examplePath = join(targetDir, ".env.example");
	const envPath = join(targetDir, ".env");
	if (existsSync(examplePath) && !existsSync(envPath)) {
		await cp(examplePath, envPath);
	}
}

function handleFatalStepFailure(
	message: string,
	error: unknown,
	continueOnError: boolean,
): void {
	if (continueOnError) {
		return;
	}
	const cause =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: String(error);
	throw new Error(`${message}: ${cause}`);
}

async function applyProjectOptions(
	targetDir: string,
	options: ProjectOptions,
): Promise<void> {
	await updatePackageJson(targetDir, options);
	await writeFile(
		join(targetDir, "src", "lib", "env.ts"),
		buildEnvFile(options),
		"utf-8",
	);
	await writeFile(
		join(targetDir, "src", "questpie", "server", "questpie.config.ts"),
		buildRuntimeConfig(options),
		"utf-8",
	);
	await writeFile(
		join(targetDir, "src", "questpie", "server", "config", "auth.ts"),
		buildAuthConfig(options),
		"utf-8",
	);
	await writeFile(
		join(targetDir, "src", "questpie", "server", "modules.ts"),
		buildServerModules(options),
		"utf-8",
	);
	// Client modules (admin/modules.ts) only exist on render-layer runtimes.
	// Gate the write on admin being selected AND the admin dir being present —
	// headless runtimes ship no admin/ directory.
	const adminDir = join(targetDir, "src", "questpie", "admin");
	const adminSelected = options.modules.includes("admin");
	if (adminSelected && existsSync(adminDir)) {
		await writeFile(
			join(adminDir, "modules.ts"),
			buildAdminModules(options),
			"utf-8",
		);
	}
}

async function updatePackageJson(
	targetDir: string,
	options: ProjectOptions,
): Promise<void> {
	const packageJsonPath = join(targetDir, "package.json");
	const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8")) as {
		dependencies: Record<string, string>;
		devDependencies: Record<string, string>;
	};

	// Module deps (admin/openapi are already pinned in the template; assigning
	// the same version is a no-op — workflows is the net-new entry).
	for (const mod of selectedModules(options)) {
		for (const [name, version] of Object.entries(mod.deps)) {
			packageJson.dependencies[name] = depVersion(name, version);
		}
	}

	// Adapter feature deps.
	for (const feature of selectedFeatures(options)) {
		for (const [name, version] of Object.entries(feature.deps ?? {})) {
			packageJson.dependencies[name] = version;
		}
	}

	await writeFile(
		packageJsonPath,
		`${JSON.stringify(packageJson, null, "\t")}\n`,
	);
}

function buildEnvFile(options: ProjectOptions): string {
	const mailAdapters = Array.from(
		new Set(["console", options.emailAdapter ?? "console"]),
	);
	const lines = [
		`import { createEnv } from "@t3-oss/env-core";`,
		`import { z } from "zod";`,
		``,
		`export const env = createEnv({`,
		`\tserver: {`,
		`\t\tDATABASE_URL: z.string().url(),`,
		`\t\tAPP_URL: z.string().url().default("http://localhost:3000"),`,
		`\t\tPORT: z`,
		`\t\t\t.string()`,
		`\t\t\t.transform(Number)`,
		`\t\t\t.pipe(z.number().int().positive())`,
		`\t\t\t.default(3000),`,
		`\t\tBETTER_AUTH_SECRET: z.string().min(1).default("change-me-in-production"),`,
		`\t\tMAIL_ADAPTER: z.enum(${JSON.stringify(mailAdapters)}).default("console"),`,
	];

	if (options.emailAdapter === "smtp") {
		lines.push(
			`\t\tSMTP_HOST: z.string().optional(),`,
			`\t\tSMTP_PORT: z`,
			`\t\t\t.string()`,
			`\t\t\t.transform(Number)`,
			`\t\t\t.pipe(z.number().int().positive())`,
			`\t\t\t.optional(),`,
		);
	}
	if (options.emailAdapter === "resend") {
		lines.push(`\t\tRESEND_API_KEY: z.string().optional(),`);
	}
	if (options.emailAdapter === "plunk") {
		lines.push(`\t\tPLUNK_SECRET_KEY: z.string().optional(),`);
	}
	// Adapter feature env vars (REDIS_URL etc.), deduped across selected axes.
	for (const line of dedupe(
		selectedFeatures(options).flatMap((f) => f.envVars ?? []),
	)) {
		lines.push(line);
	}

	lines.push(
		`\t},`,
		`\truntimeEnv: process.env,`,
		`\temptyStringAsUndefined: true,`,
		`});`,
		``,
	);

	return lines.join("\n");
}

function buildRuntimeConfig(options: ProjectOptions): string {
	// Adapter imports follow the axis display order (queue, email, realtime, kv).
	// `email` keeps its bespoke import builder; the other axes pull from the
	// feature registry. Imports are deduped (shared redis lines collapse).
	const queueImports =
		features.queue?.[options.queueAdapter ?? "pg-boss"]?.configImports ?? [];
	const realtimeImports =
		features.realtime?.[options.realtimeBroker ?? "none"]?.configImports ?? [];
	const kvImports =
		features.kv?.[options.kvAdapter ?? "memory"]?.configImports ?? [];

	const imports = [
		`import { runtimeConfig } from "questpie/app";`,
		`import { ConsoleAdapter } from "questpie/adapters/console";`,
		...dedupe([
			...queueImports,
			...buildEmailConfigImports(options),
			...realtimeImports,
			...kvImports,
		]),
	];
	imports.push(``, `import { env } from "@/lib/env";`, ``);

	// Helper order: email, realtime, then KV.
	const realtimeHelper =
		features.realtime?.[options.realtimeBroker ?? "none"]?.configHelper;
	const kvHelper = features.kv?.[options.kvAdapter ?? "memory"]?.configHelper;
	const helpers: string[] = [
		...buildEmailConfigHelper(options),
		...(realtimeHelper ?? []),
		...(kvHelper ?? []),
	];

	const configEntries = [
		`\tapp: { url: env.APP_URL },`,
		`\tdb: { url: env.DATABASE_URL },`,
		`\tstorage: { basePath: "/api" },`,
		`\temail: {`,
		`\t\tadapter: ${buildEmailAdapterExpression(options)},`,
		`\t},`,
	];
	// Adapter config entries follow the axis order queue, realtime, kv.
	for (const { axis, option } of selectedFeatureOptions(options)) {
		const entry = features[axis]?.[option]?.configEntry;
		if (entry) configEntries.push(...entry(options));
	}
	configEntries.push(
		`\tcli: {`,
		`\t\tmigrations: { directory: "./src/migrations" },`,
		`\t},`,
	);

	return [
		`/**`,
		` * QUESTPIE Runtime Configuration`,
		` *`,
		` * Runtime-only configuration: database, adapters, secrets.`,
		` * Entity definitions are codegen-generated.`,
		` */`,
		``,
		...imports,
		...helpers,
		`export default runtimeConfig({`,
		...configEntries,
		`});`,
		``,
	].join("\n");
}

function buildAuthConfig(options: ProjectOptions): string {
	const adminSelected = options.modules.includes("admin");
	const imports = adminSelected
		? [
				`import { admin, bearer } from "better-auth/plugins";`,
				`import { authConfig } from "questpie/app";`,
			]
		: [`import { authConfig } from "questpie/app";`];
	const entries = adminSelected
		? [
				`\tplugins: [admin(), bearer()],`,
				`\temailAndPassword: {`,
				`\t\tenabled: true,`,
				`\t\trequireEmailVerification: false,`,
				`\t},`,
			]
		: [
				`\temailAndPassword: {`,
				`\t\tenabled: true,`,
				`\t\trequireEmailVerification: false,`,
				`\t},`,
			];

	return [
		...imports,
		``,
		`export default authConfig({`,
		...entries,
		`});`,
		``,
	].join("\n");
}

function buildEmailAdapterExpression(options: ProjectOptions): string {
	if (options.emailAdapter === "smtp") {
		return `env.MAIL_ADAPTER === "smtp"\n\t\t\t? new SmtpAdapter({\n\t\t\t\t\ttransport: {\n\t\t\t\t\t\thost: env.SMTP_HOST || "localhost",\n\t\t\t\t\t\tport: env.SMTP_PORT || 1025,\n\t\t\t\t\t\tsecure: false,\n\t\t\t\t\t},\n\t\t\t\t})\n\t\t\t: new ConsoleAdapter({ logHtml: false })`;
	}
	if (options.emailAdapter === "resend") {
		return `env.MAIL_ADAPTER === "resend"\n\t\t\t? new ResendAdapter({ apiKey: requiredEnv(env.RESEND_API_KEY, "RESEND_API_KEY") })\n\t\t\t: new ConsoleAdapter({ logHtml: false })`;
	}
	if (options.emailAdapter === "plunk") {
		return `env.MAIL_ADAPTER === "plunk"\n\t\t\t? new PlunkAdapter({ apiKey: requiredEnv(env.PLUNK_SECRET_KEY, "PLUNK_SECRET_KEY") })\n\t\t\t: new ConsoleAdapter({ logHtml: false })`;
	}
	return `new ConsoleAdapter({ logHtml: false })`;
}

/** Email adapter import lines for `questpie.config.ts` (ConsoleAdapter is always imported separately). */
function buildEmailConfigImports(options: ProjectOptions): string[] {
	if (options.emailAdapter === "smtp") {
		return [`import { SmtpAdapter } from "questpie/adapters/smtp";`];
	}
	if (options.emailAdapter === "resend") {
		return [`import { ResendAdapter } from "questpie/adapters/resend";`];
	}
	if (options.emailAdapter === "plunk") {
		return [`import { PlunkAdapter } from "questpie/adapters/plunk";`];
	}
	return [];
}

/** Email helper block (`requiredEnv`) for adapters that read required secrets. */
function buildEmailConfigHelper(options: ProjectOptions): string[] {
	if (options.emailAdapter === "resend" || options.emailAdapter === "plunk") {
		return [
			`function requiredEnv(value: string | undefined, name: string): string {`,
			`\tif (!value) throw new Error(\`Missing required environment variable: \${name}\`);`,
			`\treturn value;`,
			`}`,
			``,
		];
	}
	return [];
}

function buildServerModules(options: ProjectOptions): string {
	const selected = selectedModules(options);
	const imports = [
		`/**`,
		` * Modules — static module dependencies for this project.`,
		` */`,
		...selected.map(
			(mod) => `import { ${mod.serverSymbol} } from "${mod.serverImport}";`,
		),
	];

	return [
		...imports,
		``,
		`const modules = [`,
		...selected.map((mod) => `\t${mod.serverSymbol},`),
		`] as const;`,
		``,
		`export default modules;`,
		``,
	].join("\n");
}

function buildAdminModules(options: ProjectOptions): string {
	const clientModules = selectedModules(options).filter(
		(mod) => mod.clientImport && mod.clientSymbol,
	);
	const imports = clientModules.map(
		(mod) => `import { ${mod.clientSymbol} } from "${mod.clientImport}";`,
	);
	const symbols = clientModules.map((mod) => mod.clientSymbol as string);

	return [
		...imports,
		``,
		`export default [${symbols.join(", ")}] as const;`,
		``,
	].join("\n");
}

/** Install the canonical skills synchronously so success or failure is known. */
function installProjectSkills(targetDir: string): boolean {
	const result = spawnSync("bunx", getSkillsInstallArgs(), {
		cwd: targetDir,
		stdio: "inherit",
	});
	return result.status === 0 && result.error === undefined;
}

export async function scaffold(options: ProjectOptions): Promise<void> {
	const resolvedOptions: ProjectOptions = {
		...options,
		queueAdapter: options.queueAdapter ?? "pg-boss",
		emailAdapter: options.emailAdapter ?? "console",
		realtimeBroker: options.realtimeBroker ?? "none",
		kvAdapter: options.kvAdapter ?? "memory",
	};
	const spinner = p.spinner();
	const targetDir = resolve(process.cwd(), resolvedOptions.projectName);
	const continueOnError = resolvedOptions.continueOnError === true;

	// Check if directory exists
	if (existsSync(targetDir)) {
		p.log.error(`Directory ${resolvedOptions.projectName} already exists.`);
		process.exit(1);
	}

	const vars: TemplateVars = {
		projectName: resolvedOptions.projectName,
		databaseName: resolvedOptions.databaseName,
		databaseUser: resolvedOptions.databaseName,
		databasePassword: generatePassword(),
		authSecret: generatePassword(48),
	};

	// 1. Copy template
	spinner.start("Copying template files");
	const templatesDir = getTemplatesDir();
	const templateDir = join(templatesDir, resolvedOptions.templateId);
	if (!existsSync(templateDir)) {
		spinner.stop(
			label.error(`Template "${resolvedOptions.templateId}" not found`),
		);
		process.exit(1);
	}
	await cp(templateDir, targetDir, { recursive: true });
	spinner.stop(label.success("Copied template files"));

	// 2. Rename dotfiles (npm strips .gitignore and .env on publish)
	spinner.start("Processing template");
	await renameGitignore(targetDir);
	await renameEnvExample(targetDir);

	// 3. Replace template variables
	await processDirectory(targetDir, vars);
	await createLocalEnv(targetDir);
	await applyProjectOptions(targetDir, resolvedOptions);
	spinner.stop(label.success("Processed template variables"));

	// 4. Install dependencies
	const pm = detectPackageManager();
	if (resolvedOptions.installDeps) {
		spinner.start(`Installing dependencies with ${pm}`);
		try {
			installDependencies(targetDir, pm);
			spinner.stop(label.success("Installed dependencies"));
		} catch (error) {
			spinner.stop(label.warn("Failed to install dependencies"));
			handleFatalStepFailure(
				"Dependency installation failed",
				error,
				continueOnError,
			);
		}
	}

	// 5. Install the canonical QUESTPIE agent skills and record skills-lock.json.
	// This is synchronous: never claim success before the installer exits.
	if (resolvedOptions.installSkills) {
		p.log.info(label.info("Installing QUESTPIE agent skills"));
		if (installProjectSkills(targetDir)) {
			p.log.success(label.success("Installed QUESTPIE agent skills"));
		} else {
			p.log.warn(
				label.warn(
					`Skills install failed - run \`bunx ${getSkillsInstallArgs().join(" ")}\` in the project`,
				),
			);
		}
	}

	// 6. Generate QUESTPIE app/types
	if (resolvedOptions.installDeps && resolvedOptions.runCodegen) {
		spinner.start("Generating QUESTPIE app");
		try {
			runPackageScript(targetDir, pm, "scaffold:generate");
			spinner.stop(label.success("Generated QUESTPIE app"));
		} catch (error) {
			spinner.stop(label.warn("Failed to run codegen"));
			handleFatalStepFailure("QUESTPIE codegen failed", error, continueOnError);
		}
	}

	// 7. Initialize git
	if (resolvedOptions.initGit && isGitInstalled()) {
		spinner.start("Initializing git repository");
		try {
			gitInit(targetDir);
			spinner.stop(label.success("Initialized git repository"));
		} catch {
			spinner.stop(label.warn("Failed to initialize git — run manually"));
		}
	}

	// Done!
	const runScript = (script: string) =>
		pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`;
	const questpieBin = pm === "npm" ? "npx questpie" : "bunx questpie";

	p.note(
		[
			`cd ${resolvedOptions.projectName}`,
			"",
			"# Review the generated environment",
			"# .env has already been created from .env.example",
			"",
			"# Start PostgreSQL",
			"docker compose up -d",
			"",
			"# Regenerate and type-check the scaffold",
			runScript("scaffold:verify"),
			"",
			"# Create local database tables (development only; never use db:push in production)",
			runScript("db:push"),
			"",
			"# Start dev server",
			runScript("dev"),
			"",
			"# Add entities (auto-runs codegen)",
			`${questpieBin} add collection products`,
			`${questpieBin} add global marketing`,
			"",
			"# If you create files manually",
			runScript("questpie:generate"),
			"",
			"# For production: commit reviewed migrations, then apply them during deployment",
			runScript("migrate:create"),
			runScript("migrate"),
		].join("\n"),
		"Next steps",
	);

	p.outro(`${label.success("Done!")} Happy building with QUESTPIE!`);
}
