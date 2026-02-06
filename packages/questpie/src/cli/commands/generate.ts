import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  DrizzleMigrationGenerator,
  type GenerateMigrationOptions,
} from "../../server/migration/generator.js";
import { getMigrationDirectory, loadQuestpieConfig } from "../config.js";

/**
 * Mock stdin to automatically answer interactive prompts with Enter (select default)
 * Returns a restore function to revert stdin back to original
 */
function mockStdinForNonInteractive(): () => void {
  const originalStdin = process.stdin;
  const originalIsTTY = process.stdin.isTTY;
  const originalSetRawMode = (process.stdin as any).setRawMode;

  let buffer = "";
  let promptCount = 0;

  // Create a readable stream that provides Enter keypresses on demand
  const mockStream = new Readable({
    read() {
      // Auto-answer with Enter after a short delay
      setTimeout(() => {
        promptCount++;
        // Send Enter key (carriage return)
        this.push("\r");
        this.push("\n");
      }, 100);
    },
  }) as any;

  mockStream.isTTY = true;
  mockStream.setRawMode = (mode: boolean) => {
    return mockStream;
  };

  // Also intercept key events if using readline
  mockStream.on = function (event: string, listener: any) {
    if (event === "keypress") {
      // Auto-trigger keypress with Enter
      setTimeout(() => listener("\r", { name: "return", sequence: "\r" }), 50);
    }
    return Readable.prototype.on.call(this, event, listener);
  };

  // Override stdin
  (process as any).stdin = mockStream;

  // Return restore function
  return () => {
    (process as any).stdin = originalStdin;
    process.stdin.isTTY = originalIsTTY;
    if (originalSetRawMode) {
      (process.stdin as any).setRawMode = originalSetRawMode;
    }
    console.log(
      `\n✅ Auto-answered ${promptCount} prompts in non-interactive mode`,
    );
  };
}

/**
 * Generate a new migration
 *
 * This command:
 * 1. Loads the config
 * 2. Gets the current schema via app.getSchema()
 * 3. Builds cumulative snapshot from migrations loaded via .migrations([...])
 * 4. Generates migration file with embedded snapshot
 * 5. Saves to cli.migrations.directory
 */
export async function generateMigrationCommand(
  configPath: string,
  options: GenerateMigrationOptions = {},
): Promise<void> {
  console.log("📝 Generating migration...\n");

  // Handle non-interactive mode by auto-answering prompts
  let stdinRestore: (() => void) | undefined;
  if (options.nonInteractive) {
    console.log(
      "🤖 Running in non-interactive mode (auto-selecting defaults)\n",
    );
    stdinRestore = mockStdinForNonInteractive();
  }

  try {
    await generateMigrationInternal(configPath, options);
  } finally {
    // Restore stdin if it was mocked
    if (stdinRestore) {
      stdinRestore();
    }
  }
}

async function generateMigrationInternal(
  configPath: string,
  options: GenerateMigrationOptions = {},
): Promise<void> {
  // Resolve config path
  const resolvedConfigPath = join(process.cwd(), configPath);

  if (!existsSync(resolvedConfigPath)) {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  // Load config
  const cmsConfig = await loadQuestpieConfig(resolvedConfigPath);
  const app = cmsConfig.app;

  // Get schema from app
  const schema = app.getSchema();
  console.log(
    `📊 Loaded schema with ${Object.keys(schema).length} definitions`,
  );

  // Get migrations from app config (loaded via .migrations([...]))
  const existingMigrations = app.config.migrations?.migrations ?? [];
  console.log(`📦 Found ${existingMigrations.length} existing migrations`);

  // Get migration directory from CLI config
  const migrationDir = join(process.cwd(), getMigrationDirectory(cmsConfig));

  // Create migration directory if needed
  if (!existsSync(migrationDir)) {
    mkdirSync(migrationDir, { recursive: true });
  }

  // Generate timestamp and name
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\..+/, "")
    .slice(0, 15); // YYYYMMDDTHHmmss

  // Generate random name if not provided
  const randomName = options.name || generateRandomName();

  // New format: timestamp_random_name
  const fileBaseName = `${timestamp}_${randomName}`;

  // Convert to camelCase with timestamp at end for variable name
  const camelCaseName = toCamelCase(randomName);
  const migrationVariableName = `${camelCaseName}${timestamp}`;

  console.log(`📝 Migration name: ${fileBaseName}`);
  console.log(`🔤 Variable name: ${migrationVariableName}`);
  console.log(`📁 Directory: ${migrationDir}\n`);

  if (options.dryRun) {
    console.log("🔍 DRY RUN - Would generate migration with the above details");
    return;
  }

  // Generate migration using DrizzleMigrationGenerator
  const generator = new DrizzleMigrationGenerator();

  // Build cumulative snapshot from existing migrations' embedded snapshots
  const cumulativeSnapshot =
    generator.getCumulativeSnapshotFromMigrations(existingMigrations);

  const result = await generator.generateMigration({
    migrationName: migrationVariableName,
    fileBaseName,
    schema,
    migrationDir,
    cumulativeSnapshot,
  });

  if (result.skipped) {
    console.log(
      "⏭️  No schema changes detected, skipping migration generation",
    );
    return;
  }

  // Update migrations index file
  await updateMigrationsIndex(
    migrationDir,
    fileBaseName,
    migrationVariableName,
  );

  console.log("\n✅ Migration generated successfully!");
  console.log(`\nNext steps:`);
  console.log(
    `  1. Review the migration file: ${migrationDir}/${fileBaseName}.ts`,
  );
  console.log(
    `  2. Import migrations in your CMS config: .migrations(migrations)`,
  );
  console.log(`  3. Run migrations: bun questpie migrate:up`);
}

/**
 * Update migrations/index.ts to export all migrations
 * Preserves existing imports and formatting, only appends new migration
 */
async function updateMigrationsIndex(
  migrationDir: string,
  fileName: string,
  migrationName: string,
): Promise<void> {
  const indexPath = join(migrationDir, "index.ts");

  if (existsSync(indexPath)) {
    const existingContent = readFileSync(indexPath, "utf-8");

    // Check if migration is already present (by name or filename)
    if (
      existingContent.includes(migrationName) ||
      existingContent.includes(fileName)
    ) {
      console.log(`📝 Migration already in index: ${indexPath}`);
      return;
    }

    // Append the new migration to existing file
    const updatedContent = appendMigrationToIndex(
      existingContent,
      fileName,
      migrationName,
    );
    writeFileSync(indexPath, updatedContent);
    console.log(`📝 Updated migrations index: ${indexPath}`);
  } else {
    // Create new index from scratch
    const content = generateFreshIndex(migrationDir);
    writeFileSync(indexPath, content);
    console.log(`📝 Created migrations index: ${indexPath}`);
  }
}

/**
 * Append a new migration to existing index.ts content
 * Preserves existing formatting, imports, and export order
 */
function appendMigrationToIndex(
  existingContent: string,
  fileName: string,
  migrationName: string,
): string {
  // Generate the new import line
  const newImport = `import { ${migrationName} } from "./${fileName}.js"`;

  // Find the last import statement to insert after
  const importRegex = /^import .+ from .+;?\s*$/gm;
  let lastImportMatch: RegExpExecArray | null = null;

  for (const match of existingContent.matchAll(importRegex)) {
    lastImportMatch = match;
  }

  let contentWithImport: string;
  if (lastImportMatch) {
    // Insert after the last import
    const insertPos = lastImportMatch.index + lastImportMatch[0].length;
    contentWithImport =
      existingContent.slice(0, insertPos) +
      "\n" +
      newImport +
      existingContent.slice(insertPos);
  } else {
    // No imports found, add after type import
    contentWithImport = existingContent.replace(
      /(import type \{ Migration \} from .+;?\n?)/,
      `$1${newImport}\n`,
    );
  }

  // Find and update the migrations array
  const arrayRegex =
    /(export const migrations:\s*Migration\[\]\s*=\s*\[)([\s\S]*?)(\];?)/;
  const arrayMatch = contentWithImport.match(arrayRegex);

  if (arrayMatch) {
    const [_fullMatch, arrayStart, arrayContent, arrayEnd] = arrayMatch;
    const trimmedContent = arrayContent.trim();

    // Detect indentation style from existing content
    const indentMatch = arrayContent.match(/\n(\s+)/);
    const indent = indentMatch ? indentMatch[1] : "\t";

    let newArrayContent: string;
    if (trimmedContent) {
      // Add comma after last item if not present, then add new migration
      const contentWithComma = trimmedContent.endsWith(",")
        ? trimmedContent
        : `${trimmedContent},`;
      newArrayContent = `\n${indent}${contentWithComma}\n${indent}${migrationName},\n`;
    } else {
      newArrayContent = `\n${indent}${migrationName},\n`;
    }

    contentWithImport = contentWithImport.replace(
      arrayRegex,
      `${arrayStart}${newArrayContent}${arrayEnd}`,
    );
  }

  return contentWithImport;
}

/**
 * Generate a fresh index.ts by scanning migration files in directory
 */
function generateFreshIndex(migrationDir: string): string {
  const { readdirSync } = require("node:fs");

  const migrationFiles = readdirSync(migrationDir)
    .filter((file: string) => file.endsWith(".ts") && file !== "index.ts")
    .sort();

  const imports: string[] = [];
  const exports: string[] = [];

  for (const file of migrationFiles) {
    const baseName = file.replace(".ts", "");
    const varMatch = baseName.match(/\d+_(.+)$/);
    if (varMatch) {
      const varName = toCamelCase(varMatch[1] || baseName);
      const timestamp = baseName.match(/^(\d+)_/)?.[1] || "";
      const migrationVarName = `${varName}${timestamp}`;

      imports.push(`import { ${migrationVarName} } from "./${baseName}.js"`);
      exports.push(migrationVarName);
    }
  }

  return `import type { Migration } from "questpie"

${imports.join("\n")}

export const migrations: Migration[] = [
\t${exports.join(",\n\t")},
]
`;
}

function generateRandomName(): string {
  const adjectives = [
    "happy",
    "bright",
    "swift",
    "bold",
    "calm",
    "eager",
    "fancy",
    "gentle",
    "jolly",
    "kind",
  ];
  const colors = [
    "red",
    "blue",
    "green",
    "yellow",
    "purple",
    "orange",
    "pink",
    "crimson",
    "azure",
    "emerald",
  ];
  const animals = [
    "zebra",
    "panda",
    "tiger",
    "eagle",
    "dolphin",
    "falcon",
    "phoenix",
    "dragon",
    "griffin",
    "unicorn",
  ];

  const randomItem = (arr: string[]) =>
    arr[Math.floor(Math.random() * arr.length)]!;

  return `${randomItem(adjectives)}_${randomItem(colors)}_${randomItem(animals)}`;
}

function toCamelCase(str: string): string {
  return str
    .replace(/[-_\s]+(.)?/g, (_, char) => (char ? char.toUpperCase() : ""))
    .replace(/^(.)/, (char) => char.toLowerCase());
}
