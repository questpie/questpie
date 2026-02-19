import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SeedCategory } from "../../server/seed/types.js";
import { getSeedDirectory, loadQuestpieConfig } from "../config.js";

export type GenerateSeedOptions = {
	configPath: string;
	name: string;
	category?: SeedCategory;
	dryRun?: boolean;
};

/**
 * Generate a new seed file
 *
 * This command:
 * 1. Generates a .seed.ts scaffold file
 * 2. Auto-updates seeds/index.ts to include the new seed
 */
export async function generateSeedCommand(
	options: GenerateSeedOptions,
): Promise<void> {
	const category = options.category || "dev";
	const name = options.name;

	// Convert name to kebab-case for filename
	const kebabName = toKebabCase(name);
	// Convert name to camelCase for variable name
	const camelName = toCamelCase(name);

	// Load config to get seeds directory
	const resolvedConfigPath = join(process.cwd(), options.configPath);

	let seedDir: string;
	if (existsSync(resolvedConfigPath)) {
		const cmsConfig = await loadQuestpieConfig(resolvedConfigPath);
		seedDir = join(process.cwd(), getSeedDirectory(cmsConfig));
	} else {
		seedDir = join(process.cwd(), "./src/seeds");
	}

	const fileName = `${kebabName}.seed`;
	const filePath = join(seedDir, `${fileName}.ts`);

	console.log(`🌱 Generating seed: ${name}\n`);
	console.log(`  📁 Directory: ${seedDir}`);
	console.log(`  📝 File: ${fileName}.ts`);
	console.log(`  🔤 Variable: ${camelName}Seed`);
	console.log(`  📂 Category: ${category}`);
	console.log("");

	if (options.dryRun) {
		console.log("🔍 DRY RUN - Would generate seed with the above details");
		return;
	}

	// Create seeds directory if needed
	if (!existsSync(seedDir)) {
		mkdirSync(seedDir, { recursive: true });
	}

	// Check if file already exists
	if (existsSync(filePath)) {
		throw new Error(`Seed file already exists: ${filePath}`);
	}

	// Generate seed file content
	const seedContent = generateSeedFileContent(camelName, category);
	writeFileSync(filePath, seedContent);
	console.log(`✅ Created seed file: ${filePath}`);

	// Update seeds index
	await updateSeedsIndex(seedDir, fileName, `${camelName}Seed`);

	console.log("\n✅ Seed generated successfully!");
	console.log("\nNext steps:");
	console.log(`  1. Edit the seed file: ${filePath}`);
	console.log("  2. Import seeds in your app config: .build({ seeds: [...] })");
	console.log("  3. Run seeds: bun questpie seed");
}

/**
 * Generate seed file scaffold content
 */
function generateSeedFileContent(
	camelName: string,
	category: SeedCategory,
): string {
	return `import type { Seed } from "questpie"

export const ${camelName}Seed: Seed = {
	id: "${camelName}",
	description: "TODO: describe what this seed does",
	category: "${category}",
	async run({ app, ctx, log }) {
		// TODO: Add seed logic here
		//
		// Use API for data operations:
		//   await app.api.collections.myCollection.create(ctx, { data: { ... } })
		//
		// For idempotent seeds, check if data exists first:
		//   const existing = await app.api.collections.myCollection.find(ctx, { where: { ... } })
		//   if (existing.docs.length > 0) { log("Already seeded, skipping"); return }

		log("Seed completed")
	},
	// Uncomment to enable undo:
	// async undo({ app, ctx, log }) {
	// 	log("Undoing seed...")
	// },
}
`;
}

/**
 * Update seeds/index.ts to include the new seed
 */
async function updateSeedsIndex(
	seedDir: string,
	fileName: string,
	variableName: string,
): Promise<void> {
	const indexPath = join(seedDir, "index.ts");

	if (existsSync(indexPath)) {
		const existingContent = readFileSync(indexPath, "utf-8");

		// Check if seed is already present
		if (
			existingContent.includes(variableName) ||
			existingContent.includes(fileName)
		) {
			console.log(`📝 Seed already in index: ${indexPath}`);
			return;
		}

		// Append the new seed to existing file
		const updatedContent = appendSeedToIndex(
			existingContent,
			fileName,
			variableName,
		);
		writeFileSync(indexPath, updatedContent);
		console.log(`📝 Updated seeds index: ${indexPath}`);
	} else {
		// Create new index from scratch
		const content = generateFreshSeedIndex(fileName, variableName);
		writeFileSync(indexPath, content);
		console.log(`📝 Created seeds index: ${indexPath}`);
	}
}

/**
 * Append a new seed to existing index.ts
 */
function appendSeedToIndex(
	existingContent: string,
	fileName: string,
	variableName: string,
): string {
	// Generate the new import line
	const newImport = `import { ${variableName} } from "./${fileName}.js"`;

	// Find the last import statement to insert after
	const importRegex = /^import .+ from .+;?\s*$/gm;
	let lastImportMatch: RegExpExecArray | null = null;

	for (const match of existingContent.matchAll(importRegex)) {
		lastImportMatch = match;
	}

	let contentWithImport: string;
	if (lastImportMatch) {
		const insertPos = lastImportMatch.index + lastImportMatch[0].length;
		contentWithImport =
			existingContent.slice(0, insertPos) +
			"\n" +
			newImport +
			existingContent.slice(insertPos);
	} else {
		// No imports found, add at top after type import
		contentWithImport = existingContent.replace(
			/(import type \{ Seed \} from .+;?\n?)/,
			`$1${newImport}\n`,
		);
	}

	// Find and update the seeds array
	const arrayRegex =
		/(export const seeds:\s*Seed\[\]\s*=\s*\[)([\s\S]*?)(\];?)/;
	const arrayMatch = contentWithImport.match(arrayRegex);

	if (arrayMatch) {
		const [_fullMatch, arrayStart, arrayContent, arrayEnd] = arrayMatch;
		const trimmedContent = arrayContent.trim();

		// Detect indentation style from existing content
		const indentMatch = arrayContent.match(/\n(\s+)/);
		const indent = indentMatch ? indentMatch[1] : "\t";

		let newArrayContent: string;
		if (trimmedContent) {
			const contentWithComma = trimmedContent.endsWith(",")
				? trimmedContent
				: `${trimmedContent},`;
			newArrayContent = `\n${indent}${contentWithComma}\n${indent}${variableName},\n`;
		} else {
			newArrayContent = `\n${indent}${variableName},\n`;
		}

		contentWithImport = contentWithImport.replace(
			arrayRegex,
			`${arrayStart}${newArrayContent}${arrayEnd}`,
		);
	}

	return contentWithImport;
}

/**
 * Generate a fresh seeds/index.ts
 */
function generateFreshSeedIndex(
	fileName: string,
	variableName: string,
): string {
	return `import type { Seed } from "questpie"

import { ${variableName} } from "./${fileName}.js"

export const seeds: Seed[] = [
	${variableName},
]
`;
}

function toKebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

function toCamelCase(str: string): string {
	return str
		.replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
		.replace(/^(.)/, (char) => char.toLowerCase());
}
