/**
 * example-errors ratchet — full-app tsc error counts must never increase.
 *
 * The package gate (`packages/questpie` tsconfig) is STRUCTURALLY BLIND to the
 * AppContext⇄config codegen cycle: it compiles only a module fixture, never a
 * composed full-app `.generated/index.ts`. The TRUTH about the cycle (and the
 * `any`-leak it masks) lives in the EXAMPLE apps. This ratchet makes that truth
 * a CI gate: it cold-typechecks each example, counts `error TS` diagnostics, and
 * compares against the committed baseline in scripts/example-errors.json. Any
 * increase fails; decreases should be locked in by re-baselining (--update) in
 * the same PR. It is the monotonic net the codegen migration burns down against.
 *
 * Load-bearing verification caveat (see ideal-codegen-design §5.3a): the example
 * error count is sensitive to packages/questpie/tsconfig.tsbuildinfo — a warm
 * package buildinfo MASKS a regression because the example resolves `questpie`
 * via the workspace symlink to dev `exports["."] = "./src/exports/index.ts"`
 * (SOURCE), so the skew is incremental-cache, not dist/src. Every measure() here
 * therefore (a) deletes every *.tsbuildinfo under the example first AND (b) runs
 * tsc with `--incremental false` — a cold compile every time.
 *
 * This mirrors any-census.ts (baseline JSON + --update + fail-on-increase) and
 * reuses type-budget.ts's cold-tsc invocation shape.
 *
 * Usage:
 *   bun run scripts/example-errors.ts            # check against baseline
 *   bun run scripts/example-errors.ts --update   # rewrite baseline from current state
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BASELINE_PATH = join(ROOT, "scripts", "example-errors.json");

/** Example apps whose composed full-app index exercises the codegen cycle. */
const EXAMPLES = [
	"examples/toy-factory-backend",
	"examples/city-portal",
	"examples/tanstack-barbershop",
];

/** Count of `error TS####` diagnostic lines in a tsc run. */
const ERROR_LINE = /error TS\d+/g;

interface Baseline {
	$comment: string;
	examples: Record<string, number>;
}

/** Remove every *.tsbuildinfo under `dir` so the next tsc run is cold. */
function deleteTsBuildInfo(dir: string): void {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue;
			deleteTsBuildInfo(path);
		} else if (entry.name.endsWith(".tsbuildinfo")) {
			rmSync(path);
		}
	}
}

/** Cold-typecheck one example and return its `error TS` count. */
function measure(target: string): number {
	const cwd = join(ROOT, target);
	deleteTsBuildInfo(cwd);
	const res = spawnSync(
		"bunx",
		["tsc", "--noEmit", "-p", "tsconfig.json", "--incremental", "false"],
		{ cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	if (res.error) {
		console.error(`✗ ${target}: failed to spawn tsc — ${res.error.message}`);
		process.exit(1);
	}
	const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
	return out.match(ERROR_LINE)?.length ?? 0;
}

const update = process.argv.includes("--update");
const current: Record<string, number> = {};
for (const target of EXAMPLES) {
	console.log(`→ cold-typechecking ${target} ...`);
	current[target] = measure(target);
	console.log(`  ${target}: ${current[target]} error(s)`);
}

if (update) {
	const baseline: Baseline = {
		$comment:
			"example-errors baseline (cold full-app tsc error counts per example). The package gate is blind to the codegen AppContext⇄config cycle — the examples are the truth. Regenerate with `bun run scripts/example-errors.ts --update` — only commit decreases unless an increase was explicitly approved. CI fails on any increase.",
		examples: current,
	};
	writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, "\t")}\n`);
	console.log(`\n✓ wrote ${BASELINE_PATH}`);
	process.exit(0);
}

const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));

let failed = false;
let improved = false;
for (const target of EXAMPLES) {
	const allowed = baseline.examples[target];
	if (allowed === undefined) {
		console.error(`✗ ${target}: missing from baseline — run with --update`);
		failed = true;
		continue;
	}
	const got = current[target];
	if (got > allowed) {
		console.error(
			`✗ ${target}: errors went ${allowed} → ${got} (ratchet only goes down)`,
		);
		failed = true;
	} else if (got < allowed) {
		console.log(`✓ ${target}: errors dropped ${allowed} → ${got}`);
		improved = true;
	} else {
		console.log(`✓ ${target}: ${got} error(s) — at baseline`);
	}
}

if (failed) {
	console.error(
		"\nexample-errors ratchet failed: a full-app type regression was introduced. The package gate cannot see it — fix the example/codegen regression, or (if the increase is unavoidable and approved) re-baseline with --update in this PR.",
	);
	process.exit(1);
}
if (improved) {
	console.log(
		"\n✓ error counts decreased — lock it in: bun run scripts/example-errors.ts --update",
	);
} else {
	console.log("\n✓ example-errors within baseline");
}
