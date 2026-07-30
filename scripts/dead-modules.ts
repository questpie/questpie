/**
 * dead-modules ratchet — source files nothing can reach must never increase.
 *
 * Formulated as REACHABILITY from entry points, not as "who imports me".
 * The difference matters: a file that imports a specifier this script cannot
 * resolve still marks its own targets reachable where it can, and an
 * unresolvable specifier is counted and reported rather than silently making
 * something look dead. A dead-code gate that guesses is worse than none — it
 * blocks PRs on false positives until somebody disables it.
 *
 * Entry points (a file reachable from any of these is alive):
 * - every concrete target in a package.json `exports` map — the declared
 *   interface, whatever convention the package keeps it in. Assuming
 *   `src/exports/**` instead flagged all fourteen files of @questpie/openapi,
 *   which declares `src/index.ts` and `src/plugin.ts` directly.
 * - `**\/.generated/**`  codegen output, which imports the convention files
 *                        (routes/, collections/, jobs/, …) that would
 *                        otherwise look orphaned
 * - `bin` targets from each package.json
 * - everything in `allow` — see the baseline's own comment
 *
 * Deliberately NOT entry points: `test/**` and `bench/**`. A file only a test
 * reaches is exactly the thing this gate exists to find — scoped-container.ts
 * (340 lines, a PoC whose Phase 4 never happened) and compat.ts survive today
 * on nothing but their own tests.
 *
 * This is a ratchet, not a linter. It does not argue that a given file should
 * go; it stops the pile from growing while the burn-down lands. Files that are
 * genuinely reachable only by a mechanism this script cannot see (a string key,
 * a runtime path) belong in `allow` in the baseline, with a reason.
 *
 * Usage:
 *   bun run scripts/dead-modules.ts            # check against baseline
 *   bun run scripts/dead-modules.ts --update   # rewrite baseline
 *   bun run scripts/dead-modules.ts --list     # print the unreachable files
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
	packages,
	ROOT,
	resolveSpecifier,
	specifiersIn,
	tryFile,
	walk,
	workspaceSrcDirs,
} from "./lib/module-graph.js";
const BASELINE_PATH = join(ROOT, "scripts", "dead-modules.json");

/**
 * How many specifiers this script may fail to resolve before its answer stops
 * being trustworthy. Unresolved specifiers make files look LESS reachable, so
 * a silent rise here would show up as fake dead code. Fail instead.
 */
const MAX_UNRESOLVED = 40;

type Baseline = {
	$comment: string;
	packages: Record<string, number>;
	allow: Record<string, string>;
};

// ---------------------------------------------------------------------------

const ws = workspaceSrcDirs();
const pkgs = packages();

/**
 * Every target in a package's `exports` map, resolved to source.
 *
 * NOT `src/exports/**` — that is questpie's and admin's convention, and
 * assuming it flagged all fourteen files of @questpie/openapi as unreachable
 * including its plugin, because that package declares `src/index.ts`,
 * `src/server.ts` and `src/plugin.ts` directly. The declared interface is the
 * entry point, whatever shape the package keeps it in.
 *
 * Wildcard targets (`"./*": "./*"`) are skipped deliberately: questpie and
 * admin both carry one as a deep-import escape hatch, and honouring it would
 * make every file in those packages an entry and the gate worthless.
 */
function exportEntries(dir: string): string[] {
	let pkg: { exports?: unknown };
	try {
		pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
	} catch {
		return [];
	}
	const targets: string[] = [];
	const visit = (node: unknown) => {
		if (typeof node === "string") {
			if (!node.includes("*")) targets.push(node);
			return;
		}
		if (node && typeof node === "object") {
			for (const [key, value] of Object.entries(node)) {
				if (key.includes("*")) continue;
				visit(value);
			}
		}
	};
	visit(pkg.exports);

	const out: string[] = [];
	for (const t of targets) {
		if (!t.startsWith("./")) continue;
		const f = tryFile(join(dir, t)) ?? tryFile(join(dir, srcTwinOf(t)));
		if (f) out.push(f);
	}
	return out;
}

/**
 * `./dist/index.mjs` -> `./src/index.ts`. Some packages point `exports` at
 * built output rather than source (vite-plugin-iconify does), and dist is not
 * checked in — without this its only entry resolved to nothing and the whole
 * package read as unreachable.
 */
function srcTwinOf(target: string): string {
	return target
		.replace(/^\.\/dist\//, "./src/")
		.replace(/\.d\.mts$/, ".ts")
		.replace(/\.mjs$/, ".ts");
}

/** Files that seed reachability. */
const entries: string[] = [];
for (const p of pkgs) {
	entries.push(...exportEntries(p.dir));
	for (const f of walk(join(p.dir, "src"))) {
		if (f.includes("/.generated/")) entries.push(f);
	}
	try {
		const pkg = JSON.parse(
			readFileSync(join(p.dir, "package.json"), "utf8"),
		) as { bin?: Record<string, string> | string };
		const bins =
			typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
		for (const b of bins) {
			const f = tryFile(join(p.dir, srcTwinOf(b)));
			if (f) entries.push(f);
		}
	} catch {
		// no bin, or unreadable — not fatal
	}
}

/**
 * Everything outside packages/ that can import into it: apps, examples,
 * scripts, and the scaffolder templates. These are reachability SOURCES, not
 * files we judge.
 */
const externalSources: string[] = [
	...walk(join(ROOT, "apps")),
	...walk(join(ROOT, "examples")),
	...walk(join(ROOT, "scripts")),
	...walk(join(ROOT, "packages", "create-questpie", "templates")),
];

const baselineForAllow: Pick<Baseline, "allow"> = existsSync(BASELINE_PATH)
	? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
	: { allow: {} };

/**
 * An allowed file is an ENTRY, not merely an exemption. `allow` holds files
 * reached by something this script cannot see — a Deno string path, a tsdown
 * entry — which means whatever THEY import is reached too. Excluding them from
 * the count without seeding them would report their entire dependency tree as
 * dead: sandbox's guest-entry.ts alone pulls in egress-firewall.ts and
 * guest-runtime-source.ts.
 */
const allowedEntries = Object.keys(baselineForAllow.allow ?? {})
	.map((rel) => join(ROOT, rel))
	.filter((f) => existsSync(f));

let unresolved = 0;
const unresolvedSpecs: string[] = [];
const seen = new Set<string>();
const queue = [...entries, ...allowedEntries, ...externalSources];

while (queue.length > 0) {
	const file = queue.pop() as string;
	if (seen.has(file)) continue;
	seen.add(file);

	let src: string;
	try {
		src = readFileSync(file, "utf8");
	} catch {
		continue;
	}

	// Only failures originating INSIDE the code we judge can hide an edge and
	// make a package file look dead. Templates ship `.generated` files whose
	// specifiers point at the scaffolded output that does not exist yet, and
	// codegen tests reference fixtures written at test time — both resolve to
	// nothing here by design, and neither can make a package file unreachable.
	const judged =
		file.includes("/packages/") &&
		file.includes("/src/") &&
		!file.includes("/create-questpie/templates/");

	for (const spec of specifiersIn(src)) {
		// Asset imports (`./admin.css?url`) are not modules.
		if (/\.(css|svg|png|jpe?g|webp|woff2?)(\?|$)/.test(spec)) continue;

		const { file: target, external } = resolveSpecifier(spec, file, ws);
		if (target) {
			if (!seen.has(target)) queue.push(target);
		} else if (!external && judged) {
			unresolved += 1;
			unresolvedSpecs.push(`${relative(ROOT, file)}  →  ${spec}`);
		}
	}
}

const baseline: Baseline = existsSync(BASELINE_PATH)
	? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
	: {
			$comment: "",
			packages: {},
			allow: {},
		};

const allow = new Set(Object.keys(baseline.allow ?? {}));
const current: Record<string, number> = {};
const unreachableByPkg: Record<string, string[]> = {};

for (const p of pkgs) {
	const files = walk(join(p.dir, "src")).filter(
		(f) => !f.includes("/.generated/"),
	);
	const dead = files
		.filter((f) => !seen.has(f))
		.map((f) => relative(ROOT, f))
		.filter((rel) => !allow.has(rel))
		.sort();
	current[p.name] = dead.length;
	unreachableByPkg[p.name] = dead;
}

// ---------------------------------------------------------------------------

const wantList = process.argv.includes("--list");
const wantUpdate = process.argv.includes("--update");

const nameWidth = Math.max(8, ...pkgs.map((p) => p.name.length)) + 2;
console.log("\nUnreachable source files per package\n");
for (const p of pkgs) {
	const n = current[p.name] ?? 0;
	const base = baseline.packages?.[p.name];
	const delta = base === undefined ? "" : n === base ? "" : ` (was ${base})`;
	console.log(`  ${p.name.padEnd(nameWidth)}${String(n).padStart(4)}${delta}`);
	if (wantList && n > 0) {
		for (const f of unreachableByPkg[p.name] ?? []) console.log(`      ${f}`);
	}
}
console.log(`\n  unresolved specifiers: ${unresolved}`);

if (unresolved > MAX_UNRESOLVED) {
	for (const u of unresolvedSpecs.slice(0, 30)) console.error(`      ${u}`);
	console.error(
		`\n✗ ${unresolved} import specifiers could not be resolved (limit ${MAX_UNRESOLVED}).\n` +
			"  Unresolved imports make files look unreachable, so the counts below cannot\n" +
			"  be trusted. Teach resolveSpecifier() the new form before re-running.",
	);
	process.exit(2);
}

if (wantUpdate) {
	const next: Baseline = {
		$comment:
			"Unreachable source files per package. Regenerate with `bun run scripts/dead-modules.ts --update` and review the diff. Ratchet: any increase fails CI. `allow` holds files reachable only by a mechanism the resolver cannot see (string keys, runtime paths) — each needs a reason, not just a path. An allowed file is treated as an ENTRY, so whatever it imports is reachable too.",
		packages: current,
		allow: baseline.allow ?? {},
	};
	writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, "\t")}\n`);
	console.log(`\n✓ wrote ${relative(ROOT, BASELINE_PATH)}`);
	process.exit(0);
}

const failures: string[] = [];
let improved = false;
for (const p of pkgs) {
	const got = current[p.name] ?? 0;
	const want = baseline.packages?.[p.name];
	if (want === undefined) {
		failures.push(`✗ ${p.name}: missing from baseline (${got} unreachable)`);
		continue;
	}
	if (got > want) {
		failures.push(`✗ ${p.name}: unreachable files went ${want} → ${got}`);
	} else if (got < want) {
		improved = true;
	}
}

if (failures.length > 0) {
	console.error(`\n${failures.join("\n")}`);
	console.error(
		"\ndead-modules ratchet failed: new unreachable files appeared. Either wire\n" +
			"them up, delete them, or — if they are reached by a mechanism this script\n" +
			"cannot see — add them to `allow` with a reason. Run with --list to see them.",
	);
	process.exit(1);
}

if (improved) {
	console.log("\n✓ counts decreased — lock it in with --update");
} else {
	console.log("\n✓ dead-modules within baseline");
}
