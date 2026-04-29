/**
 * questpie add [type] [name]
 *
 * Plugin-driven scaffolding. Each codegen target can declare scaffold templates
 * via `scaffolds` on its `CodegenTargetContribution`. When the user runs
 * `questpie add block my-hero`, files are created in ALL targets that declare
 * a "block" scaffold (e.g. server block definition + admin-client renderer).
 *
 * Run `questpie add --list` to see all available scaffold types.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { coreCodegenPlugin, resolveTargetGraph } from "../codegen/index.js";
import type { ResolvedTarget, ScaffoldConfig } from "../codegen/types.js";
import { resolveCliPath } from "../utils.js";
import {
	generateCommand,
	loadConfigForCodegen,
	resolveEntityRoot,
} from "./codegen.js";

// ============================================================================
// Types
// ============================================================================

export interface AddOptions {
	configPath: string;
	type?: string;
	name?: string;
	dryRun?: boolean;
	list?: boolean;
	target?: string;
}

interface ScaffoldEntry {
	targetId: string;
	target: ResolvedTarget;
	scaffold: ScaffoldConfig;
}

// ============================================================================
// Main command
// ============================================================================

export async function addCommand(options: AddOptions): Promise<void> {
	// 1. Load config and resolve target graph
	const rawConfigPath = resolveCliPath(options.configPath);
	const { configPath, rootDir } = await resolveEntityRoot(rawConfigPath);
	const { plugins: userPlugins } = await loadConfigForCodegen(configPath);

	const allPlugins = [coreCodegenPlugin(), ...(userPlugins ?? [])];
	const targetGraph = resolveTargetGraph(allPlugins);

	// 2. Build scaffold registry: scaffoldName → entries[]
	const registry = buildScaffoldRegistry(targetGraph);

	// 3. Handle --list
	if (options.list) {
		printScaffoldList(registry);
		return;
	}

	// 4. Validate type and name are provided
	if (!options.type || !options.name) {
		throw new Error(
			"Usage: questpie add <type> <name>\n" +
				"Run `questpie add --list` to see available types.",
		);
	}

	const entries = registry.get(options.type);
	if (!entries || entries.length === 0) {
		const available = [...registry.keys()].sort().join(", ");
		throw new Error(
			`Unknown scaffold type: "${options.type}". Available types: ${available}\n` +
				"Run `questpie add --list` for details.",
		);
	}

	// 5. Filter by --target if specified
	const filteredEntries = options.target
		? entries.filter((e) => e.targetId === options.target)
		: entries;

	if (filteredEntries.length === 0) {
		const targetIds = entries.map((e) => e.targetId).join(", ");
		throw new Error(
			`Scaffold "${options.type}" is not available in target "${options.target}". ` +
				`Available targets: ${targetIds}`,
		);
	}

	// 6. Compute names
	const kebab = toKebabCase(options.name);
	const camel = toCamelCase(kebab);
	const pascal = toPascalCase(kebab);
	const title = toTitleCase(kebab);

	// 7. Create files in all matching targets
	let filesCreated = 0;

	for (const entry of filteredEntries) {
		const ext = entry.scaffold.extension ?? ".ts";
		const targetRootDir = resolve(rootDir, entry.target.root);
		const outDir = join(targetRootDir, entry.scaffold.dir);
		const filePath = join(outDir, `${kebab}${ext}`);

		const label =
			filteredEntries.length > 1
				? `[${entry.targetId}] ${options.type}: ${options.name}`
				: `${options.type}: ${options.name}`;

		console.log(`Adding ${label}`);
		console.log(`  File: ${filePath}`);

		if (options.dryRun) {
			const content = entry.scaffold.template({
				kebab,
				camel,
				pascal,
				title,
				targetId: entry.targetId,
			});
			console.log("\n--- Would create (dry run) ---\n");
			console.log(content);
			continue;
		}

		// Skip existing files with warning
		if (existsSync(filePath)) {
			console.warn(`  Skipped: file already exists`);
			continue;
		}

		// Create directory if needed
		mkdirSync(outDir, { recursive: true });

		// Write file
		const content = entry.scaffold.template({
			kebab,
			camel,
			pascal,
			title,
			targetId: entry.targetId,
		});
		writeFileSync(filePath, content, "utf-8");
		console.log(`  Created: ${filePath}`);
		filesCreated++;
	}

	// 8. Auto-run codegen if files were created
	if (filesCreated > 0) {
		console.log("\nRunning codegen...");
		await generateCommand({ configPath: options.configPath });
	}
}

// ============================================================================
// Scaffold registry
// ============================================================================

function buildScaffoldRegistry(
	targetGraph: Map<string, ResolvedTarget>,
): Map<string, ScaffoldEntry[]> {
	const registry = new Map<string, ScaffoldEntry[]>();

	for (const [targetId, target] of targetGraph) {
		for (const [name, scaffold] of Object.entries(target.scaffolds)) {
			let entries = registry.get(name);
			if (!entries) {
				entries = [];
				registry.set(name, entries);
			}
			entries.push({ targetId, target, scaffold });
		}
	}

	return registry;
}

// ============================================================================
// List output
// ============================================================================

function printScaffoldList(registry: Map<string, ScaffoldEntry[]>): void {
	const types = [...registry.keys()].sort();

	if (types.length === 0) {
		console.log("No scaffold types available.");
		return;
	}

	console.log("Available scaffold types:\n");

	// Find longest type name for alignment
	const maxLen = Math.max(...types.map((t) => t.length));

	for (const type of types) {
		const entries = registry.get(type)!;
		const targets = entries.map((e) => e.targetId);
		const desc = entries[0].scaffold.description ?? "";
		const descPart = desc ? ` — ${desc}` : "";
		const targetPart =
			targets.length > 1 ? ` [${targets.join(", ")}]` : ` [${targets[0]}]`;
		console.log(`  ${type.padEnd(maxLen)}${descPart}${targetPart}`);
	}

	console.log("\nUsage: questpie add <type> <name>");
	console.log("  Options: --dry-run, --target <target>");
}

// ============================================================================
// Name conversion helpers
// ============================================================================

export function toKebabCase(str: string): string {
	return str
		.replace(/([a-z])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase()
		.replace(/[^a-z0-9-]/g, "");
}

export function toCamelCase(kebab: string): string {
	return kebab.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
}

export function toPascalCase(kebab: string): string {
	const camel = toCamelCase(kebab);
	return camel.charAt(0).toUpperCase() + camel.slice(1);
}

export function toTitleCase(kebab: string): string {
	return kebab
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
