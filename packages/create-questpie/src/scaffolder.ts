import { existsSync } from "node:fs";
import { cp, readdir, readFile, rename, writeFile } from "node:fs/promises";
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
	const content = await readFile(filePath, "utf-8");
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

export async function scaffold(options: ProjectOptions): Promise<void> {
	const spinner = p.spinner();
	const targetDir = resolve(process.cwd(), options.projectName);

	// Check if directory exists
	if (existsSync(targetDir)) {
		p.log.error(`Directory ${options.projectName} already exists.`);
		process.exit(1);
	}

	const vars: TemplateVars = {
		projectName: options.projectName,
		databaseName: options.databaseName,
		databaseUser: options.databaseName,
		databasePassword: generatePassword(),
	};

	// 1. Copy template
	spinner.start("Copying template files");
	const templatesDir = getTemplatesDir();
	const templateDir = join(templatesDir, options.templateId);
	if (!existsSync(templateDir)) {
		spinner.stop(label.error(`Template "${options.templateId}" not found`));
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
	spinner.stop(label.success("Processed template variables"));

	// 4. Install dependencies
	if (options.installDeps) {
		const pm = detectPackageManager();
		spinner.start(`Installing dependencies with ${pm}`);
		try {
			installDependencies(targetDir, pm);
			spinner.stop(label.success("Installed dependencies"));
		} catch {
			spinner.stop(label.warn("Failed to install dependencies — run manually"));
		}
	}

	// 5. Initialize git
	if (options.initGit && isGitInstalled()) {
		spinner.start("Initializing git repository");
		try {
			gitInit(targetDir);
			spinner.stop(label.success("Initialized git repository"));
		} catch {
			spinner.stop(label.warn("Failed to initialize git — run manually"));
		}
	}

	// Done!
	const pm = detectPackageManager();
	const runCmd = pm === "npm" ? "npm run" : pm;

	p.note(
		[
			`cd ${options.projectName}`,
			"",
			"# Start PostgreSQL",
			"docker compose up -d",
			"",
			"# Run migrations",
			`${runCmd} questpie migrate`,
			"",
			"# Start dev server",
			`${runCmd} dev`,
		].join("\n"),
		"Next steps",
	);

	p.outro(`${label.success("Done!")} Happy building with QUESTPIE!`);
}
