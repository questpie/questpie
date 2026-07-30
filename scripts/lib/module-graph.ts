/**
 * Shared module-graph primitives for the scripts/ gates.
 *
 * Extracted when the second gate needed them. Both dead-modules and
 * deprecated-imports have to answer "what file does this specifier mean", and
 * getting that wrong is how a gate invents findings — dead-modules was wrong
 * three separate times before its numbers meant anything. One resolver, one
 * place to fix.
 *
 * Not a general module resolver. It knows exactly what this repo uses:
 * relative specifiers with TS's `.js` output naming, the `#questpie/*` and
 * `#questpie/admin/*` subpath imports, and workspace package names resolved
 * through each package's `exports` map.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ROOT = join(import.meta.dirname, "..", "..");

const SRC_EXT = [".ts", ".tsx"];

export function isSource(f: string): boolean {
	return (
		SRC_EXT.some((e) => f.endsWith(e)) &&
		!f.endsWith(".d.ts") &&
		!f.endsWith(".test.ts") &&
		!f.endsWith(".test.tsx") &&
		!f.endsWith(".test-d.ts")
	);
}

export function walk(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "dist") continue;
		const full = join(dir, entry.name);
		if (entry.isDirectory()) walk(full, out);
		else if (isSource(entry.name)) out.push(full);
	}
	return out;
}

/** Every `packages/*` with a package.json and a src/. Discovered, never listed. */
export function packages(): { name: string; dir: string }[] {
	const base = join(ROOT, "packages");
	return readdirSync(base, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => ({ name: e.name, dir: join(base, e.name) }))
		.filter(
			(p) =>
				existsSync(join(p.dir, "package.json")) &&
				existsSync(join(p.dir, "src")),
		);
}

/** package name -> src dir, for resolving cross-package workspace imports. */
export function workspaceSrcDirs(): Map<string, string> {
	const map = new Map<string, string>();
	for (const p of packages()) {
		try {
			const pkg = JSON.parse(
				readFileSync(join(p.dir, "package.json"), "utf8"),
			) as { name?: string };
			if (pkg.name) map.set(pkg.name, join(p.dir, "src"));
		} catch {
			// A package.json we cannot read is not a resolution target.
		}
	}
	return map;
}

export const IMPORT_RE =
	/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]/g;

/**
 * Comments are stripped first. This codebase documents heavily with JSDoc
 * `@example` blocks full of import statements — those specifiers are written
 * from the CONSUMER's position (`#questpie/factories`, `./posts.collection`)
 * and resolve to nothing here. Counting them as unresolved buried the real
 * signal: 64 failures, of which the overwhelming majority were prose.
 */
export function stripComments(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

export function specifiersIn(src: string): string[] {
	const out: string[] = [];
	for (const m of stripComments(src).matchAll(IMPORT_RE)) {
		const spec = m[1] ?? m[2] ?? m[3];
		// Template-literal specifiers are dynamic; nothing static to resolve.
		if (spec && !spec.includes("${")) out.push(spec);
	}
	return out;
}

/** Try every extension form a specifier may stand for. */
export function tryFile(base: string): string | null {
	const candidates = [
		base,
		...SRC_EXT.map((e) => base + e),
		...SRC_EXT.map((e) => join(base, "index" + e)),
	];
	// `./x.js` in this repo means `./x.ts` — TS's NodeNext output naming.
	if (base.endsWith(".js")) {
		const stem = base.slice(0, -3);
		candidates.push(...SRC_EXT.map((e) => stem + e));
	}
	if (base.endsWith(".jsx")) {
		const stem = base.slice(0, -4);
		candidates.push(...SRC_EXT.map((e) => stem + e));
	}
	for (const c of candidates) {
		if (existsSync(c) && isSource(c)) return c;
	}
	return null;
}

export type Resolution = { file: string | null; external: boolean };

export function resolveSpecifier(
	spec: string,
	fromFile: string,
	ws: Map<string, string>,
): Resolution {
	if (spec.startsWith(".")) {
		return { file: tryFile(resolve(dirname(fromFile), spec)), external: false };
	}
	// Subpath imports: #questpie/* -> packages/questpie/src/*,
	// #questpie/admin/* -> packages/admin/src/*
	if (spec.startsWith("#questpie/admin/")) {
		const rest = spec.slice("#questpie/admin/".length);
		return {
			file: tryFile(join(ROOT, "packages/admin/src", rest)),
			external: false,
		};
	}
	if (spec.startsWith("#questpie/")) {
		const rest = spec.slice("#questpie/".length);
		return {
			file: tryFile(join(ROOT, "packages/questpie/src", rest)),
			external: false,
		};
	}
	// Workspace package, possibly with a subpath.
	for (const [name, srcDir] of ws) {
		if (spec === name) {
			return { file: tryFile(join(srcDir, "exports/index")), external: false };
		}
		if (spec.startsWith(name + "/")) {
			const rest = spec.slice(name.length + 1);
			return {
				file:
					tryFile(join(srcDir, "exports", rest)) ?? tryFile(join(srcDir, rest)),
				external: false,
			};
		}
	}
	return { file: null, external: true };
}
