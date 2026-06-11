/**
 * Type-perf budget gate — keeps tsc instantiation counts under control.
 *
 * Runs `tsc --noEmit --extendedDiagnostics --incremental false` for
 * packages/questpie + the three flagship examples and compares the
 * deterministic metrics (Types / Instantiations) against the committed
 * budget table in scripts/type-budget.json. Wall-clock times are noisy
 * across machines; Types/Instantiations are stable for a given TS version,
 * so the gate is on instantiations only (>10% over budget fails).
 *
 * Background: the 3.6.x variance-annotation work (`in out` on the CRUD/field
 * hot-path generics) cut example-app instantiations by ~40%. This gate stops
 * silent regressions of that win.
 *
 * Usage:
 *   bun run scripts/type-budget.ts            # check against budget
 *   bun run scripts/type-budget.ts --update   # rewrite budget from current state
 *
 * Notes:
 * - Type errors in targets do NOT fail this gate (barbershop has a known
 *   pre-existing error set) — diagnostics are still emitted on exit 2.
 * - A TS version bump usually shifts counts: re-run with --update in the
 *   same PR and review the new numbers.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const BUDGET_PATH = join(ROOT, "scripts", "type-budget.json");
/** Fail when instantiations exceed budget by more than this ratio. */
const TOLERANCE = 0.10;

const TARGETS = [
	"packages/questpie",
	"examples/toy-factory-backend",
	"examples/tanstack-barbershop",
	"examples/city-portal",
];

interface Metrics {
	types: number;
	instantiations: number;
}

interface Budget {
	$comment: string;
	tsVersion: string;
	targets: Record<string, Metrics>;
}

function measure(target: string): Metrics {
	const cwd = join(ROOT, target);
	const res = spawnSync(
		"bunx",
		["tsc", "--noEmit", "-p", "tsconfig.json", "--extendedDiagnostics", "--incremental", "false"],
		{ cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
	);
	const out = `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
	const types = out.match(/^Types:\s+(\d+)/m);
	const instantiations = out.match(/^Instantiations:\s+(\d+)/m);
	if (!types || !instantiations) {
		console.error(`✗ ${target}: could not parse extendedDiagnostics output`);
		console.error(out.slice(-2000));
		process.exit(1);
	}
	return {
		types: Number(types[1]),
		instantiations: Number(instantiations[1]),
	};
}

function tsVersion(): string {
	const res = spawnSync("bunx", ["tsc", "--version"], { cwd: ROOT, encoding: "utf8" });
	return (res.stdout ?? "").trim().replace(/^Version\s+/, "");
}

const update = process.argv.includes("--update");
const version = tsVersion();
const current: Record<string, Metrics> = {};

for (const target of TARGETS) {
	console.log(`→ measuring ${target} ...`);
	current[target] = measure(target);
	console.log(
		`  types=${current[target].types.toLocaleString("en-US")} instantiations=${current[target].instantiations.toLocaleString("en-US")}`,
	);
}

if (update) {
	const budget: Budget = {
		$comment:
			"Type-perf budget (deterministic tsc metrics). Regenerate with `bun run scripts/type-budget.ts --update` and review the diff — never hand-edit. Gate: instantiations >10% over budget fails CI.",
		tsVersion: version,
		targets: current,
	};
	writeFileSync(BUDGET_PATH, `${JSON.stringify(budget, null, "\t")}\n`);
	console.log(`✓ wrote ${BUDGET_PATH}`);
	process.exit(0);
}

const budget: Budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));
if (budget.tsVersion !== version) {
	console.warn(
		`⚠ TypeScript version drift: budget recorded ${budget.tsVersion}, running ${version}. Counts may shift — if this run fails, re-baseline with --update in the same PR.`,
	);
}

let failed = false;
for (const target of TARGETS) {
	const want = budget.targets[target];
	const got = current[target];
	if (!want) {
		console.error(`✗ ${target}: missing from budget — run with --update`);
		failed = true;
		continue;
	}
	const limit = Math.round(want.instantiations * (1 + TOLERANCE));
	const delta = ((got.instantiations - want.instantiations) / want.instantiations) * 100;
	const deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
	if (got.instantiations > limit) {
		console.error(
			`✗ ${target}: instantiations ${got.instantiations.toLocaleString("en-US")} exceed budget ${want.instantiations.toLocaleString("en-US")} by ${deltaStr} (limit ${limit.toLocaleString("en-US")})`,
		);
		failed = true;
	} else if (got.instantiations < want.instantiations) {
		console.log(
			`✓ ${target}: ${deltaStr} under budget — consider ratcheting down with --update`,
		);
	} else {
		console.log(`✓ ${target}: ${deltaStr} within budget`);
	}
}

if (failed) {
	console.error(
		"\nType budget exceeded. Either fix the instantiation regression (see .agent docs on variance annotations / tsc --generateTrace) or, if the increase is intentional, update scripts/type-budget.json with --update in this PR.",
	);
	process.exit(1);
}
console.log("✓ type budget within limits");
