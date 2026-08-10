/**
 * lint-census ratchet — oxlint warning counts per package per rule may only go down.
 *
 * The Lint & Format job gates ERRORS only, and says so in its own comment:
 * warnings are unbounded, "do not read this job's green as 'the lint backlog is
 * under control'". This is the follow-up that comment names. Same shape as
 * scripts/any-census.ts: freeze the counts, fail on an increase, burn down over
 * time.
 *
 * `eslint/no-underscore-dangle` is disabled in the root Oxlint config because
 * leading underscores are the repository's documented house convention for
 * internal members. Every warning emitted here is therefore governed debt.
 *
 * Usage:
 *   bun run scripts/lint-census.ts            # check against baseline
 *   bun run scripts/lint-census.ts --update   # rewrite baseline
 *   bun run scripts/lint-census.ts --list     # show the per-rule breakdown
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(ROOT, "scripts", "lint-census.json");

type Baseline = {
	$comment: string;
	/** package -> rule code -> count */
	packages: Record<string, Record<string, number>>;
};

type Diagnostic = {
	code?: string;
	severity?: string;
	filename?: string;
};

/** Discovered, never hand-listed — a new package shows up and must be baselined. */
function packageDirs(): string[] {
	const base = join(ROOT, "packages");
	return readdirSync(base, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => existsSync(join(base, name, "package.json")))
		.sort();
}

function ownerOf(filename: string): string | null {
	const m = filename.match(/^packages\/([^/]+)\//);
	if (m) return m[1] as string;
	if (filename.startsWith("scripts/")) return "scripts";
	return null;
}

const res = spawnSync(
	"bunx",
	["oxlint", "packages/", "scripts/", "--format=json"],
	{ cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);

if (!res.stdout) {
	console.error("✗ oxlint produced no output");
	console.error(res.stderr?.slice(0, 2000) ?? "");
	process.exit(2);
}

let diagnostics: Diagnostic[];
try {
	diagnostics = (JSON.parse(res.stdout).diagnostics ?? []) as Diagnostic[];
} catch (err) {
	console.error(
		`✗ could not parse oxlint JSON: ${err instanceof Error ? err.message : err}`,
	);
	process.exit(2);
}

const current: Record<string, Record<string, number>> = {};
for (const name of [...packageDirs(), "scripts"]) current[name] = {};

let unattributed = 0;
for (const d of diagnostics) {
	// Errors are already gated by the Lint & Format job; this census is the
	// warning backlog it deliberately leaves ungated.
	if (d.severity !== "warning") continue;
	const code = d.code ?? "unknown";
	const owner = d.filename ? ownerOf(d.filename) : null;
	if (!owner || !(owner in current)) {
		unattributed += 1;
		continue;
	}
	const bucket = current[owner] as Record<string, number>;
	bucket[code] = (bucket[code] ?? 0) + 1;
}

const baseline: Baseline = existsSync(BASELINE_PATH)
	? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
	: { $comment: "", packages: {} };

const wantUpdate = process.argv.includes("--update");
const wantList = process.argv.includes("--list");

const owners = Object.keys(current).sort();
const nameWidth = Math.max(8, ...owners.map((o) => o.length)) + 2;
const totalOf = (m: Record<string, number>) =>
	Object.values(m).reduce((a, b) => a + b, 0);

console.log("\noxlint warnings per package\n");
for (const owner of owners) {
	const got = current[owner] as Record<string, number>;
	const total = totalOf(got);
	const was = baseline.packages?.[owner]
		? totalOf(baseline.packages[owner] as Record<string, number>)
		: undefined;
	const delta = was === undefined || was === total ? "" : ` (was ${was})`;
	console.log(
		`  ${owner.padEnd(nameWidth)}${String(total).padStart(5)}${delta}`,
	);
	if (wantList && total > 0) {
		for (const [code, n] of Object.entries(got).sort((a, b) => b[1] - a[1])) {
			console.log(`      ${String(n).padStart(5)}  ${code}`);
		}
	}
}
const grand = owners.reduce(
	(a, o) => a + totalOf(current[o] as Record<string, number>),
	0,
);
console.log(`\n  total ${grand}`);
if (unattributed > 0) {
	console.log(`  (${unattributed} warnings outside packages/ and scripts/)`);
}

if (wantUpdate) {
	/**
	 * Sorted before writing. Rule keys arrive in diagnostic order, which follows
	 * the file walk and therefore differs between machines — a regeneration on
	 * one box produced a diff that only REORDERED identical values, and the same
	 * mechanism would eventually show up as a macOS-versus-CI mismatch.
	 */
	const sorted: Record<string, Record<string, number>> = {};
	for (const owner of Object.keys(current).sort()) {
		const bucket = current[owner] as Record<string, number>;
		sorted[owner] = Object.fromEntries(
			Object.entries(bucket).sort(([a], [b]) => a.localeCompare(b)),
		);
	}

	const next: Baseline = {
		$comment:
			"oxlint WARNING counts per package per rule. Errors are gated separately by the Lint & Format job. Regenerate with `bun run scripts/lint-census.ts --update` and review the diff. Ratchet: any per-rule increase fails CI.",
		packages: sorted,
	};
	writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, "\t")}\n`);
	console.log(`\n✓ wrote ${relative(ROOT, BASELINE_PATH)}`);
	process.exit(0);
}

const failures: string[] = [];
let improved = false;

for (const owner of owners) {
	const got = current[owner] as Record<string, number>;
	const want = baseline.packages?.[owner];
	if (want === undefined) {
		failures.push(
			`✗ ${owner}: missing from baseline (${totalOf(got)} warnings)`,
		);
		continue;
	}
	for (const [code, n] of Object.entries(got)) {
		const before = want[code] ?? 0;
		if (n > before) {
			failures.push(`✗ ${owner}: ${code} went ${before} → ${n}`);
		} else if (n < before) {
			improved = true;
		}
	}
	for (const [code, before] of Object.entries(want)) {
		if (!(code in got) && before > 0) improved = true;
	}
}

if (failures.length > 0) {
	console.error(`\n${failures.join("\n")}`);
	console.error(
		"\nlint-census ratchet failed: new lint warnings were added. Fix them, or —\n" +
			"if the rule is wrong for this codebase — change the rule in .oxlintrc.json\n" +
			"rather than baselining more of it. Run with --list for the breakdown.",
	);
	process.exit(1);
}

if (improved) {
	console.log("\n✓ counts decreased — lock it in with --update");
} else {
	console.log("\n✓ lint-census within baseline");
}
