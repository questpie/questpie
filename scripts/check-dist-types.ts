/**
 * Dist-types gate — typecheck a real app against BUILT .d.ts output.
 *
 * Catches the class of bugs where the dts bundler mangles declarations in
 * ways source typechecks can't see — e.g. renaming a class type parameter
 * (CollectionBuilder<TState> → TState$1), which breaks declaration merging
 * with every generated augmentation and silently degrades all collections
 * to `any` for npm consumers (shipped in 3.6.0, fixed in 3.6.1).
 *
 * Run AFTER `turbo run build --filter='./packages/*'`.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

// 1. Declaration-shape assertions — type parameter lists of augmentation
//    targets must match what generated factories emit verbatim.
const ASSERTIONS: Array<{ file: string; mustContain: string; why: string }> = [
	{
		file: "packages/questpie/dist/server/collection/builder/collection-builder.d.mts",
		mustContain:
			"declare class CollectionBuilder<TState extends CollectionBuilderState>",
		why: "generated augmentations declare `interface CollectionBuilder<TState extends CollectionBuilderState>` — a renamed param (TState$1) breaks declaration merging for every consumer",
	},
	{
		file: "packages/questpie/dist/server/global/builder/global-builder.d.mts",
		mustContain:
			"declare class GlobalBuilder<TState extends GlobalBuilderState>",
		why: "same merging contract for GlobalBuilder augmentations",
	},
	{
		file: "packages/questpie/dist/server/fields/field-class.d.mts",
		mustContain:
			"declare class Field<out TState extends FieldState = FieldState, in out TMethods = {}>",
		why: "same merging contract for Field augmentations. The generated extension proxies still declare a ONE-parameter `interface Field<TState extends FieldState = FieldState>`, which merges fine with the two-parameter class — but a renamed or dropped param would break every consumer. The variance annotations are load-bearing too: `out TState` is what keeps `Field<BooleanFieldState>` assignable to `Field<FieldState>`, and losing it degrades inference without any error here",
	},
];

let failed = false;
for (const a of ASSERTIONS) {
	const path = join(ROOT, a.file);
	if (!existsSync(path)) {
		console.error(`✗ missing dist file: ${a.file} (build packages first)`);
		failed = true;
		continue;
	}
	const content = readFileSync(path, "utf8");
	if (!content.includes(a.mustContain)) {
		console.error(`✗ ${a.file}\n  expected: ${a.mustContain}\n  why: ${a.why}`);
		failed = true;
	} else {
		console.log(`✓ ${a.file}`);
	}
}

// 2. Consumer-fidelity typecheck: barbershop against dist .d.mts only.
const proj = join(ROOT, "examples/tanstack-barbershop/tsconfig.dist.json");
console.log(
	"→ tsc against dist types (examples/tanstack-barbershop/tsconfig.dist.json)",
);
const res = spawnSync("bunx", ["tsc", "--noEmit", "-p", proj], {
	cwd: join(ROOT, "examples/tanstack-barbershop"),
	encoding: "utf8",
});
const distErrors = (res.stdout + res.stderr)
	.split("\n")
	.filter((l) => l.includes("error TS"));

// Baseline: the same project against SOURCE types.
const srcRes = spawnSync("bunx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
	cwd: join(ROOT, "examples/tanstack-barbershop"),
	encoding: "utf8",
});
const srcErrors = (srcRes.stdout + srcRes.stderr)
	.split("\n")
	.filter((l) => l.includes("error TS"));

console.log(
	`dist errors: ${distErrors.length}, source baseline: ${srcErrors.length}`,
);
if (distErrors.length > srcErrors.length) {
	console.error(
		"✗ dist types produce MORE errors than source types — dts emit regressed:",
	);
	for (const l of distErrors.slice(0, 20)) console.error("  " + l);
	failed = true;
} else {
	console.log("✓ dist typecheck within source baseline");
}

process.exit(failed ? 1 : 0);
