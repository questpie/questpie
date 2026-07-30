/**
 * One-off codemod: repoint every importer of a deprecated re-export barrel at
 * the real module, so the barrel can be deleted.
 *
 * Resolves each specifier rather than pattern-matching it. That matters here:
 * `packages/admin/src/augmentation.ts` and
 * `packages/admin/src/server/augmentation.ts` are different files and both are
 * written `../augmentation.js` from somewhere, so a textual replace would break
 * the one that is not deprecated.
 *
 *   bun run scripts/repoint-shim.ts <shim-file> <replacement-file> [--write]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
	packages,
	resolveSpecifier,
	ROOT,
	walk,
	workspaceSrcDirs,
} from "./lib/module-graph.js";

const [shimArg, targetArg] = process.argv
	.slice(2)
	.filter((a) => !a.startsWith("--"));
const write = process.argv.includes("--write");

if (!shimArg || !targetArg) {
	console.error(
		"usage: bun run scripts/repoint-shim.ts <shim-file> <replacement-file> [--write]",
	);
	process.exit(2);
}

const shim = resolve(ROOT, shimArg);
const target = resolve(ROOT, targetArg);
const ws = workspaceSrcDirs();

/** `../foo/bar.ts` -> the specifier form this repo writes: `../foo/bar.js` */
function specifierFor(fromFile: string, toFile: string): string {
	let rel = relative(dirname(fromFile), toFile).replace(/\\/g, "/");
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return rel.replace(/\.tsx?$/, ".js");
}

const SPEC_RE = /(['"])([^'"]+)\1/g;
let touched = 0;
let rewrites = 0;

for (const p of packages()) {
	for (const file of walk(join(p.dir, "src"))) {
		if (file === shim) continue;
		let src: string;
		try {
			src = readFileSync(file, "utf8");
		} catch {
			continue;
		}
		if (!src.includes("from")) continue;

		let changed = false;
		const next = src.replace(SPEC_RE, (whole, quote: string, spec: string) => {
			if (!spec.startsWith(".") && !spec.startsWith("#")) return whole;
			const { file: resolved } = resolveSpecifier(spec, file, ws);
			if (resolved !== shim) return whole;
			changed = true;
			rewrites += 1;
			return `${quote}${specifierFor(file, target)}${quote}`;
		});

		if (changed) {
			touched += 1;
			console.log(`  ${relative(ROOT, file)}`);
			if (write) writeFileSync(file, next);
		}
	}
}

console.log(
	`\n${rewrites} specifier(s) in ${touched} file(s) ${write ? "rewritten" : "would be rewritten"}`,
);
