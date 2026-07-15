#!/usr/bin/env bun
/**
 * QUESTPIE skill primitive-coverage gate.
 *
 * Doctrine: "Skills are the product surface for AI — a primitive that exists
 * only in source effectively does not exist." This script makes that doctrine
 * measurable: it enumerates the public export surface (from `src/exports/`
 * entry files, following `export * from` re-exports), greps the shipped skill
 * (`skills/questpie/**`) for every symbol, and reports zeros.
 *
 * Mention-count is deliberately used only to catch unclassified public values
 * with zero skill mentions. The report groups the surface into public API,
 * advanced public API, generated/type-only, and internal instead of presenting
 * a misleading raw coverage percentage.
 *
 * Config: `skills/questpie/coverage.json` (reviewed together with the skill):
 *   - surfaces:        package → entry files/dirs to scan
 *   - skippedPackages: packages owned by another skill (audit hook)
 *   - advanced:        public symbol → reason it belongs in advanced reference material
 *   - internal:        symbol → reason; never paged on
 *   - concepts:        non-symbol primitives, each with grep patterns
 *
 * Modes:
 *   bun run scripts/skill-coverage.ts            # WARN mode (default): report, exit 0
 *   bun run scripts/skill-coverage.ts --strict   # exit 1 on any violation (CI gate)
 *   bun run scripts/skill-coverage.ts --json     # machine-readable report
 *   bun run scripts/skill-coverage.ts --all      # list every symbol, not just problems
 *
 * Violations (strict mode):
 *   - a non-internal VALUE export with 0 skill mentions
 *   - a concept whose patterns all have 0 matches
 *   - docs-nav drift: meta.json references a missing page, or an .mdx page /
 *     section exists next to a meta.json without being listed
 * Type-only exports are reported but never fail the gate (the allowlist would
 * otherwise drown in option-interface names).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const ROOT_DIR = resolve(import.meta.dir, "..");
const CONFIG_PATH = join(ROOT_DIR, "skills/questpie/coverage.json");
const DOCS_ROOT = join(ROOT_DIR, "apps/docs/content/docs");

interface CoverageConfig {
	skillRoot: string;
	surfaces: Array<{ package: string; entries: string[] }>;
	skippedPackages: Record<string, string>;
	advanced: Record<string, string>;
	internal: Record<string, string>;
	concepts: Array<{ name: string; patterns: string[] }>;
}

interface SymbolEntry {
	name: string;
	kind: "value" | "type";
	package: string;
	file: string;
}

type Verdict =
	| "public-api"
	| "advanced-public-api"
	| "unclassified"
	| "internal"
	| "generated/type-only";

interface SymbolReport extends SymbolEntry {
	mentions: number;
	verdict: Verdict;
}

// ----------------------------------------------------------------------------
// Surface extraction
// ----------------------------------------------------------------------------

function stripComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Resolve a re-export specifier to a source file inside the repo, or null for externals. */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
	let base: string | null = null;
	if (specifier.startsWith("#questpie/")) {
		base = join(
			ROOT_DIR,
			"packages/questpie/src",
			specifier.slice("#questpie/".length),
		);
	} else if (specifier.startsWith(".")) {
		base = resolve(dirname(fromFile), specifier);
	} else {
		return null; // external package — not ours to enumerate
	}

	const candidates = [
		base.replace(/\.js$/, ".ts"),
		base.replace(/\.js$/, ".tsx"),
		base,
		`${base}.ts`,
		`${base}.tsx`,
		join(base, "index.ts"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function parseExportedNames(
	code: string,
	pkg: string,
	file: string,
	out: Map<string, SymbolEntry>,
	followQueue: string[],
) {
	const clean = stripComments(code);

	// export * from "..."  /  export type * from "..."
	const starPattern = /export\s+(?:type\s+)?\*\s+from\s+["']([^"']+)["']/g;
	let match: RegExpExecArray | null;
	while ((match = starPattern.exec(clean))) {
		const resolved = resolveSpecifier(match[1]!, file);
		if (resolved) followQueue.push(resolved);
	}

	// export { A, B as C, type D } [from "..."]
	const namedPattern =
		/export\s+(type\s+)?\{([\s\S]*?)\}(?:\s*from\s*["']([^"']+)["'])?/g;
	while ((match = namedPattern.exec(clean))) {
		const groupIsType = Boolean(match[1]);
		for (const raw of match[2]!.split(",")) {
			let name = raw.trim();
			if (!name) continue;
			const isType = groupIsType || /^type\s+/.test(name);
			name = name.replace(/^type\s+/, "");
			const asMatch = name.split(/\s+as\s+/);
			name = (asMatch[1] ?? asMatch[0])!.trim(); // public name is the alias
			if (!name || name === "default") continue;
			if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
			addSymbol(out, {
				name,
				kind: isType ? "type" : "value",
				package: pkg,
				file,
			});
		}
	}

	// export function/class/const/let/var/enum NAME
	const valuePattern =
		/export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(function|class|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/g;
	while ((match = valuePattern.exec(clean))) {
		addSymbol(out, { name: match[2]!, kind: "value", package: pkg, file });
	}

	// export type/interface NAME
	const typePattern =
		/export\s+(?:declare\s+)?(type|interface)\s+([A-Za-z_$][\w$]*)/g;
	while ((match = typePattern.exec(clean))) {
		addSymbol(out, { name: match[2]!, kind: "type", package: pkg, file });
	}
}

function addSymbol(map: Map<string, SymbolEntry>, entry: SymbolEntry) {
	const existing = map.get(entry.name);
	// Prefer the value kind when a name is exported both ways (e.g. class + type)
	if (!existing || (existing.kind === "type" && entry.kind === "value")) {
		map.set(entry.name, entry);
	}
}

function collectEntryFiles(entry: string): string[] {
	const path = join(ROOT_DIR, entry);
	if (!existsSync(path)) {
		console.error(`coverage.json: surface entry does not exist: ${entry}`);
		return [];
	}
	if (statSync(path).isFile()) return [path];

	const files: string[] = [];
	const walk = (dir: string) => {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const child = join(dir, dirent.name);
			if (dirent.isDirectory()) walk(child);
			else if (
				dirent.isFile() &&
				[".ts", ".tsx"].includes(extname(dirent.name)) &&
				!dirent.name.endsWith(".d.ts") &&
				!dirent.name.includes(".test.")
			) {
				files.push(child);
			}
		}
	};
	walk(path);
	return files;
}

function extractSurface(config: CoverageConfig): SymbolEntry[] {
	const symbols = new Map<string, SymbolEntry>();

	for (const surface of config.surfaces) {
		const queue = surface.entries.flatMap(collectEntryFiles);
		const visited = new Set<string>();

		while (queue.length > 0) {
			const file = queue.pop()!;
			if (visited.has(file)) continue;
			visited.add(file);
			parseExportedNames(
				readFileSync(file, "utf-8"),
				surface.package,
				file,
				symbols,
				queue,
			);
		}
	}

	return [...symbols.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------
// Skill mention counting
// ----------------------------------------------------------------------------

function collectSkillText(skillRoot: string): string {
	const root = join(ROOT_DIR, skillRoot);
	const parts: string[] = [];
	const walk = (dir: string) => {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const child = join(dir, dirent.name);
			if (dirent.isDirectory()) walk(child);
			else if (
				dirent.isFile() &&
				[".md", ".mdx"].includes(extname(dirent.name))
			) {
				parts.push(readFileSync(child, "utf-8"));
			}
		}
	};
	walk(root);
	return parts.join("\n");
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMentions(skillText: string, symbol: string): number {
	const pattern = new RegExp(`\\b${escapeRegex(symbol)}\\b`, "g");
	return skillText.match(pattern)?.length ?? 0;
}

// ----------------------------------------------------------------------------
// Docs-nav integrity (locks in the currently-clean state)
// ----------------------------------------------------------------------------

function checkDocsNav(): string[] {
	const problems: string[] = [];
	if (!existsSync(DOCS_ROOT)) return problems;

	const metaFiles: string[] = [];
	const walk = (dir: string) => {
		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			const child = join(dir, dirent.name);
			if (dirent.isDirectory()) walk(child);
			else if (dirent.name === "meta.json") metaFiles.push(child);
		}
	};
	walk(DOCS_ROOT);

	for (const metaFile of metaFiles) {
		const dir = dirname(metaFile);
		const display = relative(ROOT_DIR, metaFile);
		let pages: unknown;
		try {
			pages = (
				JSON.parse(readFileSync(metaFile, "utf-8")) as { pages?: unknown }
			).pages;
		} catch (error) {
			problems.push(
				`${display}: invalid JSON (${error instanceof Error ? error.message : error})`,
			);
			continue;
		}
		if (!Array.isArray(pages)) continue;

		const listed = new Set<string>();
		for (const page of pages) {
			if (
				typeof page !== "string" ||
				page.startsWith("http") ||
				page.startsWith("---")
			)
				continue;
			listed.add(page);
			const exists =
				existsSync(join(dir, `${page}.mdx`)) ||
				existsSync(join(dir, `${page}.md`)) ||
				existsSync(join(dir, page, "index.mdx")) ||
				existsSync(join(dir, page, "meta.json"));
			if (!exists)
				problems.push(
					`${display}: references missing page or section \`${page}\``,
				);
		}

		for (const dirent of readdirSync(dir, { withFileTypes: true })) {
			if (dirent.name === "meta.json") continue;
			const child = join(dir, dirent.name);
			let entry: string | null = null;
			if (dirent.isFile() && [".md", ".mdx"].includes(extname(dirent.name))) {
				entry = dirent.name.replace(/\.(md|mdx)$/, "");
			} else if (
				dirent.isDirectory() &&
				(existsSync(join(child, "index.mdx")) ||
					existsSync(join(child, "meta.json")))
			) {
				entry = dirent.name;
			}
			if (!entry) continue;
			if (entry === "index" && dir !== DOCS_ROOT) continue;
			if (!listed.has(entry)) {
				problems.push(
					`${display}: page or section \`${entry}\` exists but is not listed in pages`,
				);
			}
		}
	}

	return problems;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
	const args = new Set(process.argv.slice(2));
	const strict = args.has("--strict");
	const asJson = args.has("--json");
	const showAll = args.has("--all");

	const config = JSON.parse(
		readFileSync(CONFIG_PATH, "utf-8"),
	) as CoverageConfig;
	const skillText = collectSkillText(config.skillRoot);
	const surface = extractSurface(config);

	const reports: SymbolReport[] = surface.map((entry) => {
		const mentions = countMentions(skillText, entry.name);
		let verdict: Verdict;
		if (config.internal[entry.name] !== undefined) verdict = "internal";
		else if (config.advanced[entry.name] !== undefined)
			verdict = "advanced-public-api";
		else if (entry.kind === "type") verdict = "generated/type-only";
		else if (mentions === 0) verdict = "unclassified";
		else verdict = "public-api";
		return { ...entry, mentions, verdict };
	});

	const conceptReports = config.concepts.map((concept) => {
		const matches = concept.patterns.reduce((total, pattern) => {
			return total + (skillText.match(new RegExp(pattern, "gim"))?.length ?? 0);
		}, 0);
		return { name: concept.name, matches, covered: matches > 0 };
	});

	const navProblems = checkDocsNav();

	const absentValues = reports.filter(
		(report) => report.verdict === "unclassified",
	);
	const untaughtTypes = reports.filter(
		(report) => report.verdict === "generated/type-only",
	);
	const missingConcepts = conceptReports.filter((concept) => !concept.covered);
	const staleInternal = Object.keys(config.internal).filter(
		(name) => !surface.some((entry) => entry.name === name),
	);
	const staleAdvanced = Object.keys(config.advanced).filter(
		(name) => !surface.some((entry) => entry.name === name),
	);
	const violations =
		absentValues.length + missingConcepts.length + navProblems.length;

	if (asJson) {
		console.log(
			JSON.stringify(
				{
					ok: violations === 0,
					mode: strict ? "strict" : "warn",
					summary: {
						symbols: reports.length,
						publicApi: reports.filter(
							(report) => report.verdict === "public-api",
						).length,
						advancedPublicApi: reports.filter(
							(report) => report.verdict === "advanced-public-api",
						).length,
						internal: reports.filter((report) => report.verdict === "internal")
							.length,
						unclassifiedValues: absentValues.length,
						generatedTypeOnly: untaughtTypes.length,
						missingConcepts: missingConcepts.length,
						navProblems: navProblems.length,
					},
					absentValues,
					missingConcepts,
					untaughtTypes: untaughtTypes.map((report) => report.name),
					staleAdvanced,
					staleInternal,
					navProblems,
					...(showAll ? { symbols: reports, concepts: conceptReports } : {}),
				},
				null,
				2,
			),
		);
	} else {
		console.log(
			`\nSkill coverage — ${config.skillRoot} (${strict ? "strict" : "warn"} mode)`,
		);
		console.log(
			`  Symbols: ${reports.length}  public API: ${reports.filter((report) => report.verdict === "public-api").length}  advanced public API: ${reports.filter((report) => report.verdict === "advanced-public-api").length}  generated/type-only: ${untaughtTypes.length}  internal: ${reports.filter((report) => report.verdict === "internal").length}`,
		);
		console.log(
			`  Concepts: ${conceptReports.length}  covered: ${conceptReports.filter((concept) => concept.covered).length}`,
		);
		console.log(
			`  Skipped packages: ${Object.keys(config.skippedPackages).join(", ") || "—"}\n`,
		);

		if (showAll) {
			for (const report of reports) {
				console.log(
					`  ${report.verdict.padEnd(10)} ${String(report.mentions).padStart(4)}  ${report.name}  (${report.package}, ${report.kind})`,
				);
			}
			console.log();
		}

		for (const report of absentValues) {
			console.log(
				`  ABSENT   ${report.name}  (${report.package}) — 0 mentions. Add a recipe or tag internal in skills/questpie/coverage.json.`,
			);
		}
		for (const concept of missingConcepts) {
			console.log(
				`  CONCEPT  ${concept.name} — no pattern matched in the skill.`,
			);
		}
		for (const problem of navProblems) {
			console.log(`  DOCS-NAV ${problem}`);
		}
		for (const name of staleInternal) {
			console.log(
				`  NOTE     internal allowlist entry \`${name}\` no longer matches an exported symbol (stale?)`,
			);
		}
		for (const name of staleAdvanced) {
			console.log(
				`  NOTE     advanced API entry \`${name}\` no longer matches an exported symbol (stale?)`,
			);
		}

		if (violations === 0) {
			console.log(
				"  OK — every public value export and concept is mentioned in the skill; docs nav is consistent.\n",
			);
		} else {
			console.log(
				`\n  ${violations} coverage violation(s).${strict ? "" : " (warn mode — not failing; pass --strict to gate)"}\n`,
			);
		}
	}

	process.exit(strict && violations > 0 ? 1 : 0);
}

main();
