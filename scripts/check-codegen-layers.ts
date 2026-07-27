/**
 * check-codegen-layers — ENFORCE the one-way codegen layer DAG ("proti cyklom").
 *
 * Codegen emits each app's `.generated/` as a strict DOWNWARD-only layer DAG:
 *
 *     index.ts (L3) → context.gen.ts (L2) → entities.gen.ts (L1) → names.gen.ts (L0)
 *
 * Allowed edges point DOWN only:
 *   L3 may import L2 / L1 / L0
 *   L2 may import       L1 / L0
 *   L1 may import            L0
 *   L0 imports NONE of the four layer files (it is the leaf).
 *
 * This makes the AppContext⇄config cycle and the ctx→user-code back-edges
 * impossible BY CONSTRUCTION — but nothing ENFORCED that the codegen keeps
 * emitting correct directions. This check is that enforcement: it parses the
 * import/export specifiers of the four layer files in each generated app and
 * asserts (a) per-file no-upward rules and (b) global acyclicity of the
 * 4-node intra-layer graph. Zero new dependencies — a small deterministic
 * specifier parser (TypeScript/madge/dependency-cruiser are NOT installed and
 * not needed for four files with relative same-dir edges).
 *
 * This is ADDITIVE tooling: it never reads or mutates the generated output or
 * the codegen source. It is wired into CI exactly like example-errors.ts
 * (a `check:codegen-layers` package script + a step in the `build` job).
 *
 * Human-readable companion (the type-flow graph + the severed back-edges):
 *   scripts/codegen-layer-graph.md
 *
 * Usage:
 *   bun run scripts/check-codegen-layers.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/**
 * Generated app `.generated/` dirs that emit the L0–L3 layer DAG. Only the
 * SERVER generated dirs (and the committed full-app fixture) contain the four
 * layer files; the admin module-registry `.generated/` dirs and the root-level
 * `.generated/` (factories + index only) are a different shape and are NOT
 * subject to the layer DAG, so they are intentionally excluded.
 */
const GENERATED_DIRS = [
	"examples/toy-factory-backend/src/questpie/server/.generated",
	"examples/city-portal/src/questpie/server/.generated",
	"examples/tanstack-barbershop/src/questpie/server/.generated",
	"packages/questpie/test/types/__fullapp__/.generated",
];

/**
 * The four layer files, lowest (leaf) → highest. The array INDEX is the layer
 * rank. A downward edge goes from a HIGHER rank to a LOWER rank; any edge to an
 * equal-or-higher rank is a violation.
 */
const LAYERS = ["names.gen.ts", "entities.gen.ts", "context.gen.ts", "index.ts"] as const;
type LayerFile = (typeof LAYERS)[number];

const RANK: Record<LayerFile, number> = {
	"names.gen.ts": 0,
	"entities.gen.ts": 1,
	"context.gen.ts": 2,
	"index.ts": 3,
};

/**
 * Extract every module specifier from `import`/`export … from`/bare-`import`/
 * dynamic-`import()` statements in a TS source. Deterministic regex over the
 * raw text: the generated files contain no specifier strings outside of
 * import/export positions, and we only ever care about same-dir `./*.js`
 * targets — so a precise specifier scan is sufficient and avoids a parser dep.
 */
function extractSpecifiers(source: string): string[] {
	const specifiers: string[] = [];
	// `import ... from "X"` and `export ... from "X"` (single- or multi-line).
	const fromRe = /\b(?:import|export)\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g;
	// bare `import "X"` (side-effect) — no `from`.
	const bareRe = /\bimport\s*["']([^"']+)["']/g;
	// dynamic `import("X")`.
	const dynRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
	for (const re of [fromRe, bareRe, dynRe]) {
		let m: RegExpExecArray | null;
		while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
	}
	return specifiers;
}

/**
 * If a specifier resolves to one of the four layer files in the SAME generated
 * dir, return that layer file; otherwise null (cross-package / `../` / `#alias`
 * imports are outside the intra-layer graph and ignored). Extension-AGNOSTIC:
 * matches `./entities.gen.js`, `./entities.gen.ts`, and the extensionless
 * `./entities.gen` (bundler) form alike — so the check stays meaningful
 * regardless of which import-extension convention the codegen emits.
 */
function resolveLayer(specifier: string): LayerFile | null {
	// Only same-dir relative specifiers can hit a sibling layer file; `../`,
	// `#alias`, and bare-package specifiers are outside the intra-layer graph.
	if (specifier.startsWith("../") || specifier.startsWith("#")) return null;
	// Strip a leading `./` and any module extension → the bare layer stem.
	const stem = specifier.replace(/^\.\//, "").replace(/\.(js|ts|mjs|mts)$/, "");
	for (const layer of LAYERS) {
		if (stem === layer.replace(/\.ts$/, "")) return layer;
	}
	// Bare `./` (directory import) resolves to the dir's index.
	if (stem === "") return "index.ts";
	return null;
}

interface Violation {
	dir: string;
	from: LayerFile;
	to: LayerFile;
	kind: "upward" | "self";
}

/** Build the intra-layer edge set for one generated dir and collect violations. */
function checkDir(relDir: string): { violations: Violation[]; edges: Array<[number, number]>; present: LayerFile[] } {
	const absDir = join(ROOT, relDir);
	const violations: Violation[] = [];
	const edges: Array<[number, number]> = [];
	const present: LayerFile[] = [];

	for (const file of LAYERS) {
		const path = join(absDir, file);
		if (!existsSync(path)) continue;
		present.push(file);
		const source = readFileSync(path, "utf8");
		const fromRank = RANK[file];
		const seen = new Set<LayerFile>();
		for (const spec of extractSpecifiers(source)) {
			const target = resolveLayer(spec);
			if (target === null) continue;
			if (seen.has(target)) continue;
			seen.add(target);
			const toRank = RANK[target];
			edges.push([fromRank, toRank]);
			if (toRank === fromRank) {
				violations.push({ dir: relDir, from: file, to: target, kind: "self" });
			} else if (toRank > fromRank) {
				violations.push({ dir: relDir, from: file, to: target, kind: "upward" });
			}
		}
	}
	return { violations, edges, present };
}

/**
 * Cycle detection over the 4-node intra-layer graph (belt-and-suspenders next
 * to the rank check — a pure DFS that does NOT assume the rank model, so it
 * would also catch a cycle the rank rule somehow missed). Returns the node
 * ranks on a detected back-edge, or null if acyclic.
 */
function findCycle(edges: Array<[number, number]>): [number, number] | null {
	const adj = new Map<number, number[]>();
	for (const [a, b] of edges) {
		if (!adj.has(a)) adj.set(a, []);
		adj.get(a)!.push(b);
	}
	const WHITE = 0, GRAY = 1, BLACK = 2;
	const color = new Map<number, number>();
	let back: [number, number] | null = null;

	function dfs(node: number): void {
		color.set(node, GRAY);
		for (const next of adj.get(node) ?? []) {
			const c = color.get(next) ?? WHITE;
			if (c === GRAY) {
				back ??= [node, next];
			} else if (c === WHITE) {
				dfs(next);
			}
		}
		color.set(node, BLACK);
	}

	for (const node of adj.keys()) {
		if ((color.get(node) ?? WHITE) === WHITE) dfs(node);
		if (back) break;
	}
	return back;
}

let failed = false;
let checkedDirs = 0;

for (const relDir of GENERATED_DIRS) {
	const absDir = join(ROOT, relDir);
	if (!existsSync(absDir)) {
		console.error(`✗ ${relDir}: missing — expected a generated layer-DAG dir`);
		failed = true;
		continue;
	}
	const { violations, edges, present } = checkDir(relDir);
	checkedDirs++;

	// Every dir must actually contain all four layer files — a partial emission
	// (e.g. names.gen.ts dropped) would otherwise silently pass.
	const missing = LAYERS.filter((l) => !present.includes(l));
	if (missing.length > 0) {
		console.error(`✗ ${relDir}: missing layer file(s): ${missing.join(", ")}`);
		failed = true;
	}

	const cycle = findCycle(edges);
	if (cycle) {
		const [a, b] = cycle;
		const name = (r: number) => LAYERS[r];
		console.error(`✗ ${relDir}: import CYCLE detected (${name(a)} → ${name(b)} closes a loop)`);
		failed = true;
	}

	if (violations.length > 0) {
		for (const v of violations) {
			const why =
				v.kind === "self"
					? `${v.from} imports itself`
					: `${v.from} (L${RANK[v.from]}) imports UPWARD into ${v.to} (L${RANK[v.to]})`;
			console.error(`✗ ${relDir}: ${why}`);
		}
		failed = true;
	}

	if (missing.length === 0 && !cycle && violations.length === 0) {
		console.log(`✓ ${relDir}: layer DAG one-way (L3→L2→L1→L0), acyclic`);
	}
}

if (checkedDirs === 0) {
	console.error("✗ no generated layer-DAG dirs found — nothing was checked (this is itself a failure)");
	failed = true;
}

if (failed) {
	console.error(
		"\ncheck-codegen-layers FAILED: the generated `.generated/` layer DAG has an upward import or a cycle. " +
			"The layers must point DOWNWARD only (index → context.gen → entities.gen → names.gen). " +
			"Fix the codegen emission (do NOT hand-edit the generated output) so the direction is restored.",
	);
	process.exit(1);
}

console.log(`\n✓ all ${checkedDirs} generated layer DAGs are one-way + acyclic`);
