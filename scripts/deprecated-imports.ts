/**
 * deprecated-imports ratchet — the framework's own use of its deprecated API
 * may only go down.
 *
 * A `@deprecated` tag is a promise to callers that a better path exists. When
 * the framework keeps importing the deprecated thing itself, the tag stops
 * being a migration signal and becomes decoration: the deprecated code can
 * never be removed, and a user following the tag's advice ends up on a path the
 * framework does not itself use.
 *
 * This counts imports, from non-test source under `packages/*\/src`, of symbols
 * whose declaration carries `@deprecated` — or that live in a module whose file
 * header carries it. Tests and bench are excluded: exercising a deprecated path
 * is what a compatibility test is FOR.
 *
 * The number is not zero today and this does not pretend otherwise. Every file
 * in `modules/core/routes/` imports `createCollectionRoutes`, which is marked
 * "@deprecated Use standalone handler functions instead" at
 * adapters/routes/collections.ts:789. Either the deprecation is wrong or those
 * routes have not migrated; a ratchet holds the line while that is decided.
 *
 * Usage:
 *   bun run scripts/deprecated-imports.ts            # check against baseline
 *   bun run scripts/deprecated-imports.ts --update   # rewrite baseline
 *   bun run scripts/deprecated-imports.ts --list     # show each import site
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import {
	packages,
	resolveSpecifier,
	ROOT,
	walk,
	workspaceSrcDirs,
} from "./lib/module-graph.js";

const BASELINE_PATH = join(ROOT, "scripts", "deprecated-imports.json");

type Baseline = {
	$comment: string;
	packages: Record<string, number>;
};

/** `import { a, b as c } from "x"` -> the LOCAL-side names actually imported. */
const NAMED_IMPORT_RE =
	/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Symbols a file declares as deprecated.
 *
 * Two shapes count. A JSDoc block carrying `@deprecated` immediately before an
 * export deprecates that symbol. A block carrying it before any import or at
 * the very top of the file deprecates the whole module — that is how the
 * admin `server/block/*` shims are written, and every symbol they re-export
 * inherits it.
 */
function deprecatedExportsOf(src: string): {
	names: Set<string>;
	whole: boolean;
} {
	const names = new Set<string>();
	let whole = false;

	const blocks = [...src.matchAll(/\/\*\*[\s\S]*?\*\//g)];
	for (const block of blocks) {
		if (!block[0].includes("@deprecated")) continue;
		const after = src.slice((block.index ?? 0) + block[0].length);
		const decl = after.match(
			/^\s*export\s+(?:declare\s+)?(?:const|let|var|function|async function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/,
		);
		if (decl?.[1]) {
			names.add(decl[1]);
			continue;
		}
		// `export { a, b } from "..."` or a bare re-export block
		const reexport = after.match(/^\s*export\s*\{([^}]*)\}/);
		if (reexport?.[1]) {
			for (const part of reexport[1].split(",")) {
				const name = part
					.trim()
					.split(/\s+as\s+/)[0]
					?.trim();
				if (name) names.add(name);
			}
			continue;
		}
		// A header block: nothing exported directly follows it.
		if ((block.index ?? 0) === 0 || /^\s*(import|export\s+\*)/.test(after)) {
			whole = true;
		}
	}
	return { names, whole };
}

const ws = workspaceSrcDirs();
const pkgs = packages();

/** file -> deprecated symbol names ("*" means the whole module) */
const deprecated = new Map<string, Set<string>>();
for (const p of pkgs) {
	for (const file of walk(join(p.dir, "src"))) {
		let src: string;
		try {
			src = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		if (!src.includes("@deprecated")) continue;
		const { names, whole } = deprecatedExportsOf(src);
		if (whole) names.add("*");
		if (names.size > 0) deprecated.set(file, names);
	}
}

const current: Record<string, number> = {};
const sites: Record<string, string[]> = {};

for (const p of pkgs) {
	current[p.name] = 0;
	sites[p.name] = [];

	for (const file of walk(join(p.dir, "src"))) {
		// A compatibility test exercising a deprecated path is doing its job.
		if (file.includes("/test/") || file.includes("/bench/")) continue;

		let src: string;
		try {
			src = readFileSync(file, "utf8");
		} catch {
			continue;
		}

		for (const m of src.matchAll(NAMED_IMPORT_RE)) {
			const clause = m[1] ?? "";
			const spec = m[2] ?? "";
			const { file: target } = resolveSpecifier(spec, file, ws);
			if (!target) continue;
			const marks = deprecated.get(target);
			if (!marks) continue;
			// A module deprecated as a whole taints everything it exports; the
			// admin block/ shims are the reason this case exists.
			if (target === file) continue;

			for (const part of clause.split(",")) {
				const imported = part
					.trim()
					.replace(/^type\s+/, "")
					.split(/\s+as\s+/)[0]
					?.trim();
				if (!imported) continue;
				if (marks.has("*") || marks.has(imported)) {
					current[p.name] = (current[p.name] ?? 0) + 1;
					sites[p.name]?.push(
						`${relative(ROOT, file)}  imports  ${imported}  from  ${relative(ROOT, target)}`,
					);
				}
			}
		}
	}
}

const baseline: Baseline = existsSync(BASELINE_PATH)
	? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
	: { $comment: "", packages: {} };

const wantUpdate = process.argv.includes("--update");
const wantList = process.argv.includes("--list");

const nameWidth = Math.max(8, ...pkgs.map((p) => p.name.length)) + 2;
console.log("\nInternal imports of @deprecated API\n");
for (const p of pkgs) {
	const n = current[p.name] ?? 0;
	const was = baseline.packages?.[p.name];
	const delta = was === undefined || was === n ? "" : ` (was ${was})`;
	console.log(`  ${p.name.padEnd(nameWidth)}${String(n).padStart(4)}${delta}`);
	if (wantList && n > 0) {
		for (const s of sites[p.name] ?? []) console.log(`      ${s}`);
	}
}
console.log(
	`\n  ${deprecated.size} files declare something @deprecated; ` +
		`${Object.values(current).reduce((a, b) => a + b, 0)} internal imports of it`,
);

if (wantUpdate) {
	writeFileSync(
		BASELINE_PATH,
		`${JSON.stringify(
			{
				$comment:
					"Imports of @deprecated symbols from non-test source under packages/*/src. Regenerate with `bun run scripts/deprecated-imports.ts --update` and review the diff. Ratchet: any increase fails CI. A rising number means the framework is adopting its own deprecated API, which makes the tag undeliverable — the deprecated code can never be removed.",
				packages: current,
			},
			null,
			"\t",
		)}\n`,
	);
	console.log(`\n✓ wrote ${relative(ROOT, BASELINE_PATH)}`);
	process.exit(0);
}

const failures: string[] = [];
let improved = false;
for (const p of pkgs) {
	const got = current[p.name] ?? 0;
	const want = baseline.packages?.[p.name];
	if (want === undefined) {
		failures.push(`✗ ${p.name}: missing from baseline (${got} imports)`);
	} else if (got > want) {
		failures.push(`✗ ${p.name}: deprecated imports went ${want} → ${got}`);
	} else if (got < want) {
		improved = true;
	}
}

if (failures.length > 0) {
	console.error(`\n${failures.join("\n")}`);
	console.error(
		"\ndeprecated-imports ratchet failed: new internal uses of deprecated API.\n" +
			"Use the replacement the @deprecated tag names, or — if there is no\n" +
			"replacement and the tag is wrong — remove the tag. Run with --list.",
	);
	process.exit(1);
}

console.log(
	improved
		? "\n✓ counts decreased — lock it in with --update"
		: "\n✓ deprecated-imports within baseline",
);
