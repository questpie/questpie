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
		authSecret: generatePassword(48),
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
	await createLocalEnv(targetDir);
	spinner.stop(label.success("Processed template variables"));

	// 4. Install dependencies
	const pm = detectPackageManager();
	if (options.installDeps) {
		spinner.start(`Installing dependencies with ${pm}`);
		try {
			installDependencies(targetDir, pm);
			spinner.stop(label.success("Installed dependencies"));
		} catch {
			spinner.stop(label.warn("Failed to install dependencies — run manually"));
		}
	}

	// 5. Install project-local agent skills
	if (options.installSkills) {
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
	if (options.installDeps && options.runCodegen) {
		spinner.start("Generating QUESTPIE app");
		try {
			runPackageScript(targetDir, pm, "scaffold:generate");
			spinner.stop(label.success("Generated QUESTPIE app"));
		} catch {
			spinner.stop(label.warn("Failed to run codegen — run manually"));
		}
	}

	// 7. Initialize git
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
	const runScript = (script: string) =>
		pm === "npm" ? `npm run ${script}` : `${pm} run ${script}`;
	const questpieBin = pm === "npm" ? "npx questpie" : "bunx questpie";

	p.note(
		[
			`cd ${options.projectName}`,
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
			"# Run migrations",
			runScript("migrate"),
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
		].join("\n"),
		"Next steps",
	);

	p.outro(`${label.success("Done!")} Happy building with QUESTPIE!`);
}
