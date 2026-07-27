/**
 * any-census ratchet — type-escape counts must never increase.
 *
 * Counts the cast/suppression patterns that erase type safety, per package,
 * across non-test src/ files, and compares against the committed baseline
 * in scripts/any-census.json. Any increase fails; decreases are celebrated
 * and should be locked in by re-baselining in the same PR.
 *
 * Patterns (raw occurrence counts; comment-only lines are skipped):
 * - `: any`           explicit any annotations (includes `: any[]`)
 * - `as any`          casts to any (also counted inside `as unknown as any`)
 * - `as unknown as`   double casts
 * - `@ts-expect-error` suppressions
 *
 * This is a ratchet, not a linter: it does not judge individual occurrences
 * (constraint-position `Record<string, any>` is conventional, builder-state
 * casts are intentional) — it only prevents the totals from growing while
 * the burn-down lands. Packages already at zero are additionally locked by
 * oxlint's no-explicit-any (see .oxlintrc.json overrides).
 *
 * Usage:
 *   bun run scripts/any-census.ts            # check against baseline
 *   bun run scripts/any-census.ts --update   # rewrite baseline from current state
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(ROOT, "scripts", "any-census.json");

/**
 * Discovered, never hand-listed: every `packages/*` with a package.json and a
 * src/ directory is censused. A hardcoded list is how five packages (mcp,
 * sandbox, openapi, crdt-yjs, tanstack-db) accumulated ~50 uncounted escapes —
 * they were simply never added. A newly created package now shows up here
 * automatically and fails the gate with "missing from baseline" until it is
 * baselined, instead of being silently skipped.
 *
 * Directories left behind by a removed package (stale dist/ or node_modules
 * with no package.json or src/) are skipped by the same rule.
 */
function discoverPackages(): string[] {
	const packagesDir = join(ROOT, "packages");
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter(
			(name) =>
				existsSync(join(packagesDir, name, "package.json")) &&
				existsSync(join(packagesDir, name, "src")),
		)
		.sort();
}

const PACKAGES = discoverPackages();

const PATTERNS: Record<string, RegExp> = {
	": any": /:\s*any\b/g,
	"as any": /\bas any\b/g,
	"as unknown as": /\bas unknown as\b/g,
	"@ts-expect-error": /@ts-expect-error/g,
};

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const TEST_PATH = /(\.test(-d)?\.|\.spec\.|__tests__)/;

type Counts = Record<string, number>;

function* walk(dir: string): Generator<string> {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			yield* walk(path);
		} else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) {
			yield path;
		}
	}
}

function countPackage(pkg: string): Counts {
	const srcDir = join(ROOT, "packages", pkg, "src");
	const counts: Counts = Object.fromEntries(Object.keys(PATTERNS).map((p) => [p, 0]));
	for (const file of walk(srcDir)) {
		if (TEST_PATH.test(relative(srcDir, file))) continue;
		const content = readFileSync(file, "utf8");
		for (const line of content.split("\n")) {
			const trimmed = line.trimStart();
			// Skip pure comment lines (prose like "matches any value" is not debt).
			// @ts-expect-error lives in comments by definition — always counted.
			const isComment =
				trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
			for (const [name, re] of Object.entries(PATTERNS)) {
				if (isComment && name !== "@ts-expect-error") continue;
				counts[name] += line.match(re)?.length ?? 0;
			}
		}
	}
	return counts;
}

const update = process.argv.includes("--update");
const current: Record<string, Counts> = {};
for (const pkg of PACKAGES) {
	current[pkg] = countPackage(pkg);
}

const pad = (s: string, n: number) => s.padEnd(n);
const nameWidth = Math.max(8, ...PACKAGES.map((p) => p.length)) + 2;
console.log(
	`${pad("package", nameWidth)}${Object.keys(PATTERNS).map((p) => pad(p, 18)).join("")}`,
);
for (const pkg of PACKAGES) {
	console.log(
		`${pad(pkg, nameWidth)}${Object.entries(current[pkg]).map(([, n]) => pad(String(n), 18)).join("")}`,
	);
}

if (update) {
	const baseline = {
		$comment:
			"any-census baseline (per-package type-escape counts, non-test src). Packages are DISCOVERED from packages/*/src — a new package appears here automatically and fails the gate until baselined, so never hand-edit the package list. Regenerate with `bun run scripts/any-census.ts --update` — only commit decreases unless the increase was explicitly approved. CI fails on any increase.",
		packages: current,
	};
	writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);
	console.log(`\n✓ wrote ${BASELINE_PATH}`);
	process.exit(0);
}

const baseline: { packages: Record<string, Counts> } = JSON.parse(
	readFileSync(BASELINE_PATH, "utf8"),
);

let failed = false;
let improved = false;
let unbaselined = false;
for (const pkg of PACKAGES) {
	const want = baseline.packages[pkg];
	if (!want) {
		console.error(`✗ ${pkg}: missing from baseline — run with --update`);
		failed = true;
		unbaselined = true;
		continue;
	}
	for (const [pattern, count] of Object.entries(current[pkg])) {
		const allowed = want[pattern] ?? 0;
		if (count > allowed) {
			console.error(`✗ ${pkg}: "${pattern}" went ${allowed} → ${count} (ratchet only goes down)`);
			failed = true;
		} else if (count < allowed) {
			improved = true;
		}
	}
}

// Reverse direction: a baseline entry with no package on disk is stale. Harmless
// for the ratchet itself (a deleted package cannot increase a count), but it means
// the committed JSON is drifting from reality — say so rather than carrying it.
for (const pkg of Object.keys(baseline.packages)) {
	if (!PACKAGES.includes(pkg)) {
		console.warn(`! ${pkg}: in baseline but not on disk — re-baseline to drop it`);
	}
}

if (failed) {
	console.error(
		unbaselined
			? "\nany-census ratchet failed: a package under packages/*/src has no baseline entry. If it is new, review its counts above and lock them in with `bun run scripts/any-census.ts --update`."
			: "\nany-census ratchet failed: new type escapes were added. Type the code properly (infer-first), or — for an intentional category-(b) builder cast — get the baseline bump approved and re-run with --update.",
	);
	process.exit(1);
}
if (improved) {
	console.log(
		"\n✓ counts decreased — lock it in: bun run scripts/any-census.ts --update",
	);
} else {
	console.log("\n✓ any-census within baseline");
}
