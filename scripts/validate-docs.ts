#!/usr/bin/env bun
/**
 * QUESTPIE documentation validation runner.
 *
 * This catches the high-signal drift that normal typecheck/build stages miss:
 * docs navigation, local links, public package import paths, and known stale
 * QUESTPIE API patterns in Markdown/MDX examples.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

type Severity = "error" | "warning";
type CheckName =
	| "content"
	| "docs-app"
	| "drift"
	| "imports"
	| "links"
	| "meta";

interface Issue {
	check: CheckName;
	severity: Severity;
	file: string;
	line: number;
	message: string;
}

interface ParsedArgs {
	json: boolean;
	report: boolean;
	includeArchive: boolean;
	docsApp: boolean;
	checks: Set<CheckName>;
}

interface PackageExportSurface {
	name: string;
	explicitExports: Set<string>;
	hasWildcard: boolean;
}

interface CodeBlock {
	language: string;
	body: string;
	startLine: number;
}

const ROOT_DIR = resolve(import.meta.dir, "..");
const DOCS_ROOT = join(ROOT_DIR, "apps/docs/content/docs");

const DOC_EXTENSIONS = new Set([".md", ".mdx"]);
const CODE_LANGUAGES = new Set([
	"js",
	"jsx",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"typescript",
	"javascript",
]);

const EXCLUDED_DIR_NAMES = new Set([
	".git",
	".next",
	".output",
	".source",
	".turbo",
	".changeset",
	"build",
	"coverage",
	"dist",
	"node_modules",
	"out",
]);

const GENERATED_DIR_NAMES = new Set([".generated"]);

const PUBLIC_PACKAGE_DIRS = [
	"packages/questpie",
	"packages/admin",
	"packages/tanstack-query",
	"packages/openapi",
	"packages/elysia",
	"packages/hono",
	"packages/next",
	"packages/create-questpie",
	"packages/vite-plugin-iconify",
];

const MISSING_ADMIN_CLIENT_EXPORTS = new Set([
	"BlockProps",
	"PreviewRoot",
	"getPreviewMetrics",
	"useFieldContext",
	"useFormViewContext",
	"useListViewContext",
	"useQuestpiePreview",
]);

const FUTURE_PREVIEW_EXPORTS = new Set([
	"PreviewRoot",
	"getPreviewMetrics",
	"useQuestpiePreview",
]);

const DRIFT_RULES: Array<{
	id: string;
	severity: Severity;
	pattern: RegExp;
	message: string;
}> = [
	{
		id: "questpie-server-import",
		severity: "error",
		pattern: /\bfrom\s+["']questpie\/server["']/g,
		message:
			"`questpie/server` is not a documented public export. Use a public barrel export or add an explicit package export first.",
	},
	{
		id: "questpie-config-import",
		severity: "error",
		pattern: /\bimport\s+\{[^}]*\bconfig\b[^}]*\}\s+from\s+["']questpie["']/g,
		message:
			"`config` is not exported from `questpie`; docs should usually use `runtimeConfig` or import CLI helpers from `questpie/cli`.",
	},
	{
		id: "admin-deep-import",
		severity: "error",
		pattern:
			/\bfrom\s+["']@questpie\/admin\/(?:hooks|runtime|i18n|scope)(?:\/[^"']*)?["']/g,
		message:
			"Deep admin client entrypoints are not explicit public exports. Use `@questpie/admin/client` or add a package export first.",
	},
	{
		id: "hono-elysia-root-import",
		severity: "error",
		pattern: /\bfrom\s+["']@questpie\/(?:hono|elysia)["']/g,
		message:
			"`@questpie/hono` and `@questpie/elysia` do not have root exports. Use `/server` or `/client`.",
	},
	{
		id: "seed-run-command",
		severity: "error",
		pattern: /\b(?:bunx?\s+)?questpie\s+seed:(?:run|generate)\b/g,
		message:
			"The CLI exposes `questpie seed`, `seed:undo`, `seed:status`, and `seed:reset`; `seed:run`/`seed:generate` are stale.",
	},
	{
		id: "collection-root-import",
		severity: "warning",
		pattern:
			/\bimport\s+\{[^}]*\bcollection\b[^}]*\}\s+from\s+["']questpie["']/g,
		message:
			"Convention files should import `collection` from `#questpie/factories`. Keep `questpie` imports only for package/module code.",
	},
];

function parseArgs(argv: string[]): ParsedArgs {
	const checks = new Set<CheckName>([
		"content",
		"drift",
		"imports",
		"links",
		"meta",
	]);

	const args: ParsedArgs = {
		json: false,
		report: false,
		includeArchive: false,
		docsApp: false,
		checks,
	};

	for (const arg of argv) {
		if (arg === "--json") args.json = true;
		else if (arg === "--report") args.report = true;
		else if (arg === "--include-archive") args.includeArchive = true;
		else if (arg === "--docs-app") {
			args.docsApp = true;
			args.checks.add("docs-app");
		} else if (arg.startsWith("--only=")) {
			args.checks.clear();
			for (const check of arg.slice("--only=".length).split(",")) {
				args.checks.add(check as CheckName);
			}
		} else if (arg.startsWith("--skip=")) {
			for (const check of arg.slice("--skip=".length).split(",")) {
				args.checks.delete(check as CheckName);
			}
		}
	}

	return args;
}

function toDisplayPath(path: string): string {
	return relative(ROOT_DIR, path) || ".";
}

function readText(path: string): string {
	return readFileSync(path, "utf-8");
}

function lineForIndex(content: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) {
		if (content.charCodeAt(i) === 10) line++;
	}
	return line;
}

function addIssue(
	issues: Issue[],
	check: CheckName,
	severity: Severity,
	file: string,
	line: number,
	message: string,
) {
	issues.push({
		check,
		severity,
		file: toDisplayPath(file),
		line,
		message,
	});
}

function walkDocs(
	dir: string,
	includeArchive: boolean,
	results: string[] = [],
) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);

		if (entry.isDirectory()) {
			if (entry.name.startsWith(".")) continue;
			if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
			if (GENERATED_DIR_NAMES.has(entry.name)) continue;
			if (!includeArchive && toDisplayPath(path).startsWith("docs/archive")) {
				continue;
			}
			walkDocs(path, includeArchive, results);
			continue;
		}

		if (entry.isFile() && DOC_EXTENSIONS.has(extname(entry.name))) {
			results.push(path);
		}
	}

	return results;
}

function stripCodeFences(content: string): string {
	return content.replace(/```[\s\S]*?```/g, "");
}

function extractCodeBlocks(content: string): CodeBlock[] {
	const blocks: CodeBlock[] = [];
	const fencePattern = /```([^\n]*)\n([\s\S]*?)```/g;
	let match: RegExpExecArray | null;

	while ((match = fencePattern.exec(content))) {
		const rawLanguage = match[1]?.trim() ?? "";
		const language = rawLanguage.split(/\s+/)[0]?.toLowerCase() ?? "";
		blocks.push({
			language,
			body: match[2] ?? "",
			startLine: lineForIndex(content, match.index),
		});
	}

	return blocks;
}

function loadPackageSurfaces(): Map<string, PackageExportSurface> {
	const surfaces = new Map<string, PackageExportSurface>();

	for (const dir of PUBLIC_PACKAGE_DIRS) {
		const packageJsonPath = join(ROOT_DIR, dir, "package.json");
		if (!existsSync(packageJsonPath)) continue;

		const packageJson = JSON.parse(readText(packageJsonPath)) as {
			name?: string;
			exports?: Record<string, unknown>;
			publishConfig?: { exports?: Record<string, unknown> };
		};
		if (!packageJson.name) continue;

		const exportsMap =
			packageJson.publishConfig?.exports ?? packageJson.exports;
		const explicitExports = new Set<string>();
		let hasWildcard = false;

		for (const key of Object.keys(exportsMap ?? {})) {
			if (key.includes("*")) hasWildcard = true;
			else explicitExports.add(key);
		}

		surfaces.set(packageJson.name, {
			name: packageJson.name,
			explicitExports,
			hasWildcard,
		});
	}

	return surfaces;
}

function parsePackageSpecifier(specifier: string): {
	packageName: string;
	subpath: string;
} | null {
	if (
		specifier.startsWith(".") ||
		specifier.startsWith("/") ||
		specifier.startsWith("#") ||
		specifier.startsWith("node:")
	) {
		return null;
	}

	const parts = specifier.split("/");
	if (specifier.startsWith("@")) {
		if (parts.length < 2) return null;
		const packageName = `${parts[0]}/${parts[1]}`;
		const rest = parts.slice(2).join("/");
		return { packageName, subpath: rest ? `./${rest}` : "." };
	}

	const packageName = parts[0]!;
	const rest = parts.slice(1).join("/");
	return { packageName, subpath: rest ? `./${rest}` : "." };
}

function extractImportSpecifiers(code: string): Array<{
	specifier: string;
	index: number;
}> {
	const imports: Array<{ specifier: string; index: number }> = [];
	const fromPattern =
		/\b(?:import|export)\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/g;
	const barePattern = /\bimport\s+["']([^"']+)["']/g;
	let match: RegExpExecArray | null;

	while ((match = fromPattern.exec(code))) {
		imports.push({ specifier: match[1]!, index: match.index });
	}

	while ((match = barePattern.exec(code))) {
		imports.push({ specifier: match[1]!, index: match.index });
	}

	return imports;
}

function normalizeNamedImport(name: string): string {
	return name
		.trim()
		.replace(/^type\s+/, "")
		.split(/\s+as\s+/)[0]!
		.trim();
}

function extractNamedImports(code: string): Array<{
	specifier: string;
	names: string[];
	index: number;
}> {
	const imports: Array<{ specifier: string; names: string[]; index: number }> =
		[];
	const pattern =
		/\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["']([^"']+)["']/g;
	let match: RegExpExecArray | null;

	while ((match = pattern.exec(code))) {
		const names = match[1]!
			.split(",")
			.map(normalizeNamedImport)
			.filter(Boolean);
		imports.push({ specifier: match[2]!, names, index: match.index });
	}

	return imports;
}

function validateImports(
	file: string,
	content: string,
	surfaces: Map<string, PackageExportSurface>,
	issues: Issue[],
) {
	for (const block of extractCodeBlocks(content)) {
		if (block.language && !CODE_LANGUAGES.has(block.language)) continue;

		for (const imported of extractImportSpecifiers(block.body)) {
			const parsed = parsePackageSpecifier(imported.specifier);
			if (!parsed) continue;

			const surface = surfaces.get(parsed.packageName);
			if (!surface) continue;

			const line =
				block.startLine + lineForIndex(block.body, imported.index) - 1;
			if (surface.explicitExports.has(parsed.subpath)) continue;

			if (surface.hasWildcard) {
				addIssue(
					issues,
					"imports",
					"error",
					file,
					line,
					`Documented import \`${imported.specifier}\` relies on a wildcard export. Use an explicit public entrypoint or add one to publishConfig.exports.`,
				);
				continue;
			}

			addIssue(
				issues,
				"imports",
				"error",
				file,
				line,
				`Documented import \`${imported.specifier}\` is not exported by \`${parsed.packageName}\`.`,
			);
		}

		for (const imported of extractNamedImports(block.body)) {
			if (imported.specifier !== "@questpie/admin/client") continue;

			const missing = imported.names.filter((name) => {
				if (!MISSING_ADMIN_CLIENT_EXPORTS.has(name)) return false;
				if (
					isFuturePreviewDesignNote(content) &&
					FUTURE_PREVIEW_EXPORTS.has(name)
				) {
					return false;
				}
				return true;
			});
			if (missing.length === 0) continue;

			const line =
				block.startLine + lineForIndex(block.body, imported.index) - 1;
			addIssue(
				issues,
				"imports",
				"error",
				file,
				line,
				`These names are not exported from \`@questpie/admin/client\`: ${missing.join(", ")}.`,
			);
		}
	}
}

function isFuturePreviewDesignNote(content: string): boolean {
	return (
		content.includes("Preview V2") &&
		(content.includes("planned Preview V2") ||
			content.includes("Preview V2 protocol design note") ||
			content.includes("planned architecture") ||
			content.includes("not export `useQuestpiePreview`"))
	);
}

function validateDriftRules(file: string, content: string, issues: Issue[]) {
	for (const rule of DRIFT_RULES) {
		let match: RegExpExecArray | null;
		rule.pattern.lastIndex = 0;

		while ((match = rule.pattern.exec(content))) {
			if (isIntentionalBadExample(content, match.index)) continue;
			addIssue(
				issues,
				"drift",
				rule.severity,
				file,
				lineForIndex(content, match.index),
				`${rule.message} (${rule.id})`,
			);
		}
	}
}

function isIntentionalBadExample(content: string, index: number): boolean {
	const before = content.slice(Math.max(0, index - 240), index).toLowerCase();
	return (
		before.includes("wrong") ||
		before.includes("incorrect") ||
		before.includes("anti-pattern") ||
		before.includes("do not") ||
		before.includes("don't") ||
		before.includes("not ")
	);
}

function docsRouteForFile(file: string): string {
	const rel = relative(DOCS_ROOT, file).replaceAll("\\", "/");
	const withoutExt = rel.replace(/\.(md|mdx)$/, "");
	if (withoutExt === "index") return "";
	if (withoutExt.endsWith("/index")) {
		return withoutExt.slice(0, -"/index".length);
	}
	return withoutExt;
}

function buildDocsRoutes(): Set<string> {
	const routes = new Set<string>();
	if (!existsSync(DOCS_ROOT)) return routes;

	for (const file of walkDocs(DOCS_ROOT, true, [])) {
		if (extname(file) !== ".mdx") continue;
		const route = docsRouteForFile(file);
		routes.add(route);
		routes.add(`${route}/`.replace(/^\//, ""));
	}

	for (const file of findFiles(DOCS_ROOT, "meta.json")) {
		const route = relative(DOCS_ROOT, dirname(file)).replaceAll("\\", "/");
		routes.add(route);
		routes.add(`${route}/`.replace(/^\//, ""));
	}

	return routes;
}

function normalizeDocsHref(href: string): string {
	const noHash = href.split("#")[0]!;
	const noQuery = noHash.split("?")[0]!;
	return noQuery.replace(/^\/docs\/?/, "").replace(/^\/+|\/+$/g, "");
}

function validateLinks(file: string, content: string, issues: Issue[]) {
	const docsRoutes = buildDocsRoutes();
	const withoutCode = stripCodeFences(content);
	const linkPattern = /!?\[[^\]]*?\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
	let match: RegExpExecArray | null;

	while ((match = linkPattern.exec(withoutCode))) {
		const rawHref = match[1]!.trim().replace(/^<|>$/g, "");
		if (!rawHref || shouldSkipHref(rawHref)) continue;

		const line = lineForIndex(withoutCode, match.index);
		if (rawHref.startsWith("/docs")) {
			const route = normalizeDocsHref(rawHref);
			if (!docsRoutes.has(route) && !docsRoutes.has(`${route}/`)) {
				addIssue(
					issues,
					"links",
					"error",
					file,
					line,
					`Internal docs link \`${rawHref}\` does not resolve to an MDX page.`,
				);
			}
			continue;
		}

		if (rawHref.startsWith("/")) continue;

		const cleanHref = rawHref.split("#")[0]!.split("?")[0]!;
		if (!cleanHref) continue;

		const target = resolve(dirname(file), cleanHref);
		if (hasFileLikeExtension(cleanHref) && !existsSync(target)) {
			addIssue(
				issues,
				"links",
				"error",
				file,
				line,
				`Relative link target \`${rawHref}\` does not exist.`,
			);
		}
	}
}

function shouldSkipHref(href: string): boolean {
	return (
		href.startsWith("#") ||
		href.startsWith("http://") ||
		href.startsWith("https://") ||
		href.startsWith("mailto:") ||
		href.startsWith("tel:")
	);
}

function hasFileLikeExtension(path: string): boolean {
	const extension = extname(path);
	return extension.length > 1;
}

function validateDocsContent(file: string, content: string, issues: Issue[]) {
	if (!file.startsWith(DOCS_ROOT) || extname(file) !== ".mdx") return;

	if (!content.startsWith("---\n")) {
		addIssue(
			issues,
			"content",
			"error",
			file,
			1,
			"Docs MDX pages must start with frontmatter.",
		);
		return;
	}

	const end = content.indexOf("\n---", 4);
	if (end === -1) {
		addIssue(
			issues,
			"content",
			"error",
			file,
			1,
			"Docs MDX frontmatter is not closed.",
		);
		return;
	}

	const frontmatter = content.slice(4, end);
	if (!/^title:\s*.+/m.test(frontmatter)) {
		addIssue(
			issues,
			"content",
			"error",
			file,
			1,
			"Docs MDX frontmatter must include a title.",
		);
	}
}

function validateMetaFiles(issues: Issue[]) {
	if (!existsSync(DOCS_ROOT)) return;

	const metaFiles = findFiles(DOCS_ROOT, "meta.json");
	for (const file of metaFiles) {
		let meta: { pages?: unknown };
		try {
			meta = JSON.parse(readText(file));
		} catch (error) {
			addIssue(
				issues,
				"meta",
				"error",
				file,
				1,
				`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			continue;
		}

		if (!Array.isArray(meta.pages)) continue;

		const dir = dirname(file);
		const listed = new Set<string>();
		for (const page of meta.pages) {
			if (typeof page !== "string") continue;
			if (page.startsWith("http") || page.startsWith("---")) continue;
			listed.add(page);

			if (!docsMetaEntryExists(dir, page)) {
				addIssue(
					issues,
					"meta",
					"error",
					file,
					1,
					`meta.json references missing docs page or section \`${page}\`.`,
				);
			}
		}

		for (const entry of immediateDocsEntries(dir)) {
			if (entry === "index" && dir !== DOCS_ROOT) continue;
			if (!listed.has(entry)) {
				addIssue(
					issues,
					"meta",
					"warning",
					file,
					1,
					`Docs page or section \`${entry}\` exists next to this meta.json but is not listed in pages.`,
				);
			}
		}
	}
}

function docsMetaEntryExists(dir: string, page: string): boolean {
	return (
		existsSync(join(dir, `${page}.mdx`)) ||
		existsSync(join(dir, `${page}.md`)) ||
		existsSync(join(dir, page, "index.mdx")) ||
		existsSync(join(dir, page, "meta.json"))
	);
}

function immediateDocsEntries(dir: string): string[] {
	const entries: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "meta.json") continue;

		const path = join(dir, entry.name);
		if (entry.isFile() && [".md", ".mdx"].includes(extname(entry.name))) {
			entries.push(basename(entry.name, extname(entry.name)));
		} else if (
			entry.isDirectory() &&
			(existsSync(join(path, "index.mdx")) ||
				existsSync(join(path, "meta.json")))
		) {
			entries.push(entry.name);
		}
	}

	return entries.sort();
}

function findFiles(dir: string, filename: string, results: string[] = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
			findFiles(path, filename, results);
		} else if (entry.isFile() && entry.name === filename) {
			results.push(path);
		}
	}

	return results;
}

function runDocsAppCheck(issues: Issue[]) {
	const result = spawnSync(
		"bun",
		["--cwd", "apps/docs", "run", "types:check"],
		{
			cwd: ROOT_DIR,
			env: process.env,
			stdio: "pipe",
			timeout: 5 * 60 * 1000,
		},
	);

	if (result.status === 0) return;

	const output = `${result.stdout?.toString() ?? ""}\n${
		result.stderr?.toString() ?? ""
	}`.trim();
	const lastLines = output.split("\n").slice(-20).join("\n");
	addIssue(
		issues,
		"docs-app",
		"error",
		join(ROOT_DIR, "apps/docs/package.json"),
		1,
		`Docs app typecheck failed:\n${lastLines}`,
	);
}

function printHumanReport(files: string[], issues: Issue[], args: ParsedArgs) {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");

	console.log("\nDocs validation");
	console.log(`  Files scanned: ${files.length}`);
	console.log(`  Checks: ${[...args.checks].sort().join(", ")}`);
	console.log(`  Errors: ${errors.length}`);
	console.log(`  Warnings: ${warnings.length}\n`);

	for (const issue of issues) {
		const marker = issue.severity === "error" ? "error" : "warn";
		console.log(
			`${marker.padEnd(5)} ${issue.check.padEnd(8)} ${issue.file}:${issue.line}`,
		);
		for (const line of issue.message.split("\n")) {
			console.log(`       ${line}`);
		}
	}

	if (issues.length > 0) console.log();
}

function printJsonReport(files: string[], issues: Issue[], args: ParsedArgs) {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	console.log(
		JSON.stringify(
			{
				ok: errors.length === 0,
				reportMode: args.report,
				files: files.map(toDisplayPath),
				checks: [...args.checks].sort(),
				summary: {
					errors: errors.length,
					warnings: warnings.length,
				},
				issues,
			},
			null,
			2,
		),
	);
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const issues: Issue[] = [];
	const files = walkDocs(ROOT_DIR, args.includeArchive).sort();
	const surfaces = loadPackageSurfaces();

	for (const file of files) {
		const content = readText(file);
		if (args.checks.has("content")) validateDocsContent(file, content, issues);
		if (args.checks.has("drift")) validateDriftRules(file, content, issues);
		if (args.checks.has("imports")) {
			validateImports(file, content, surfaces, issues);
		}
		if (args.checks.has("links")) validateLinks(file, content, issues);
	}

	if (args.checks.has("meta")) validateMetaFiles(issues);
	if (args.checks.has("docs-app")) runDocsAppCheck(issues);

	issues.sort((a, b) =>
		a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
	);

	if (args.json) printJsonReport(files, issues, args);
	else printHumanReport(files, issues, args);

	const hasErrors = issues.some((issue) => issue.severity === "error");
	process.exit(hasErrors && !args.report ? 1 : 0);
}

main();
