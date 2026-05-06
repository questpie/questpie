import { existsSync } from "node:fs";
import {
	cp,
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import * as p from "@clack/prompts";

import type { ProjectOptions } from "./prompts.js";
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

type SkillSource = {
	name: string;
	candidates: string[];
};

function getSkillSources(targetDir: string): SkillSource[] {
	return [
		{
			name: "questpie",
			candidates: [
				resolve(import.meta.dirname, "..", "skills", "questpie"),
				join(targetDir, "node_modules", "questpie", "skills", "questpie"),
				resolve(
					import.meta.dirname,
					"..",
					"..",
					"questpie",
					"skills",
					"questpie",
				),
				resolve(import.meta.dirname, "..", "..", "..", "skills", "questpie"),
			],
		},
		{
			name: "questpie-admin",
			candidates: [
				resolve(import.meta.dirname, "..", "skills", "questpie-admin"),
				join(
					targetDir,
					"node_modules",
					"@questpie",
					"admin",
					"skills",
					"questpie-admin",
				),
				resolve(
					import.meta.dirname,
					"..",
					"..",
					"admin",
					"skills",
					"questpie-admin",
				),
				resolve(
					import.meta.dirname,
					"..",
					"..",
					"..",
					"skills",
					"questpie-admin",
				),
			],
		},
	];
}

async function installProjectSkills(targetDir: string): Promise<string[]> {
	const installed: string[] = [];
	const skillsDir = join(targetDir, ".agents", "skills");

	for (const skill of getSkillSources(targetDir)) {
		const source = skill.candidates.find((candidate) => existsSync(candidate));
		if (!source) continue;

		const destination = join(skillsDir, skill.name);
		await mkdir(skillsDir, { recursive: true });
		await rm(destination, { recursive: true, force: true });
		await cp(source, destination, { recursive: true, dereference: true });
		installed.push(skill.name);
	}

	return installed;
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
		join(targetDir, "src", "questpie", "server", "modules.ts"),
		buildServerModules(options),
		"utf-8",
	);
	await writeFile(
		join(targetDir, "src", "questpie", "admin", "modules.ts"),
		buildAdminModules(options),
		"utf-8",
	);
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

	if (options.queueAdapter === "bullmq") {
		packageJson.dependencies.bullmq = "^5.0.0";
	}
	if (
		options.queueAdapter === "bullmq" ||
		options.realtimeAdapter === "redis-streams" ||
		options.kvAdapter === "redis"
	) {
		packageJson.dependencies.redis = "^5.0.0";
	}
	if (options.includeWorkflows) {
		packageJson.dependencies["@questpie/workflows"] = "latest";
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
	if (
		options.queueAdapter === "bullmq" ||
		options.realtimeAdapter === "redis-streams" ||
		options.kvAdapter === "redis"
	) {
		lines.push(
			`\t\tREDIS_URL: z.string().url().default("redis://localhost:6379"),`,
		);
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
	const imports = [
		`import { runtimeConfig } from "questpie";`,
		`import { ConsoleAdapter } from "questpie/adapters/console";`,
	];
	if (options.queueAdapter === "pg-boss") {
		imports.push(`import { pgBossAdapter } from "questpie/adapters/pg-boss";`);
	}
	if (options.queueAdapter === "bullmq") {
		imports.push(`import { bullMQAdapter } from "questpie/adapters/bullmq";`);
	}
	if (options.emailAdapter === "smtp") {
		imports.push(`import { SmtpAdapter } from "questpie/adapters/smtp";`);
	}
	if (options.emailAdapter === "resend") {
		imports.push(`import { ResendAdapter } from "questpie/adapters/resend";`);
	}
	if (options.emailAdapter === "plunk") {
		imports.push(`import { PlunkAdapter } from "questpie/adapters/plunk";`);
	}
	if (options.realtimeAdapter === "pg-notify") {
		imports.push(
			`import { pgNotifyAdapter } from "questpie/adapters/pg-notify";`,
		);
	}
	if (options.realtimeAdapter === "redis-streams") {
		imports.push(
			`import { redisStreamsAdapter } from "questpie/adapters/redis-streams";`,
		);
	}
	if (options.kvAdapter === "redis") {
		imports.push(
			`import { redisKVAdapter } from "questpie/adapters/redis-kv";`,
		);
		imports.push(`import { createClient } from "redis";`);
	}
	imports.push(``, `import { env } from "@/lib/env.js";`, ``);

	const helpers: string[] = [];
	if (options.emailAdapter === "resend" || options.emailAdapter === "plunk") {
		helpers.push(
			`function requiredEnv(value: string | undefined, name: string): string {`,
			`\tif (!value) throw new Error(\`Missing required environment variable: \${name}\`);`,
			`\treturn value;`,
			`}`,
			``,
		);
	}
	if (options.kvAdapter === "redis") {
		helpers.push(
			`async function getRedis() {`,
			`\tconst redis = createClient({ url: env.REDIS_URL });`,
			`\tawait redis.connect();`,
			`\treturn redis;`,
			`}`,
			``,
		);
	}

	const configEntries = [
		`\tapp: { url: env.APP_URL },`,
		`\tdb: { url: env.DATABASE_URL },`,
		`\tstorage: { basePath: "/api" },`,
		`\temail: {`,
		`\t\tadapter: ${buildEmailAdapterExpression(options)},`,
		`\t},`,
	];
	if (options.queueAdapter === "pg-boss") {
		configEntries.push(
			`\tqueue: {`,
			`\t\tadapter: pgBossAdapter({ connectionString: env.DATABASE_URL }),`,
			`\t},`,
		);
	}
	if (options.queueAdapter === "bullmq") {
		configEntries.push(
			`\tqueue: {`,
			`\t\tadapter: bullMQAdapter({ connection: { url: env.REDIS_URL } }),`,
			`\t},`,
		);
	}
	if (options.realtimeAdapter === "pg-notify") {
		configEntries.push(
			`\trealtime: {`,
			`\t\tadapter: pgNotifyAdapter({ connectionString: env.DATABASE_URL }),`,
			`\t},`,
		);
	}
	if (options.realtimeAdapter === "redis-streams") {
		configEntries.push(
			`\trealtime: {`,
			`\t\tadapter: redisStreamsAdapter({ url: env.REDIS_URL }),`,
			`\t},`,
		);
	}
	if (options.kvAdapter === "redis") {
		configEntries.push(
			`\tkv: {`,
			`\t\tadapter: redisKVAdapter({ client: getRedis, keyPrefix: "${options.projectName}:" }),`,
			`\t},`,
		);
	}

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

function buildServerModules(options: ProjectOptions): string {
	const imports = [
		`/**`,
		` * Modules — static module dependencies for this project.`,
		` */`,
		`import { adminModule } from "@questpie/admin/server";`,
		`import { openApiModule } from "@questpie/openapi";`,
	];
	const modules = ["adminModule", "openApiModule"];
	if (options.includeWorkflows) {
		imports.push(
			`import { workflowsModule } from "@questpie/workflows/server";`,
		);
		modules.push("workflowsModule");
	}

	return [
		...imports,
		``,
		`const modules = [`,
		...modules.map((mod) => `\t${mod},`),
		`] as const;`,
		``,
		`export default modules;`,
		``,
	].join("\n");
}

function buildAdminModules(options: ProjectOptions): string {
	if (!options.includeWorkflows) {
		return `export { default } from "@questpie/admin/client-module";\n`;
	}

	const categories = [
		"views",
		"components",
		"fields",
		"pages",
		"widgets",
		"blocks",
	];
	return [
		`import adminClientModule from "@questpie/admin/client-module";`,
		`import { workflowsClientModule } from "@questpie/workflows/client";`,
		``,
		`export default {`,
		`\tname: "app-admin" as const,`,
		...categories.map(
			(category) =>
				`\t${category}: { ...adminClientModule.${category}, ...workflowsClientModule.${category} },`,
		),
		`};`,
		``,
	].join("\n");
}

export async function scaffold(options: ProjectOptions): Promise<void> {
	const resolvedOptions: ProjectOptions = {
		...options,
		queueAdapter: options.queueAdapter ?? "pg-boss",
		emailAdapter: options.emailAdapter ?? "console",
		realtimeAdapter: options.realtimeAdapter ?? "none",
		kvAdapter: options.kvAdapter ?? "memory",
		includeWorkflows: options.includeWorkflows ?? false,
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

	// 5. Install project-local agent skills
	if (resolvedOptions.installSkills) {
		spinner.start("Installing QUESTPIE agent skills");
		try {
			const installedSkills = await installProjectSkills(targetDir);
			if (installedSkills.length > 0) {
				spinner.stop(
					label.success(`Installed skills: ${installedSkills.join(", ")}`),
				);
			} else {
				spinner.stop(
					label.warn(
						"Could not find packaged skills — run `bunx skill add questpie/questpie` manually if available",
					),
				);
			}
		} catch {
			spinner.stop(label.warn("Failed to install skills — continuing"));
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
			"# Create local database tables",
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
			"# For production migrations",
			runScript("migrate:create"),
			runScript("migrate"),
		].join("\n"),
		"Next steps",
	);

	p.outro(`${label.success("Done!")} Happy building with QUESTPIE!`);
}
