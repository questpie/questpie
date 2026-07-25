/**
 * Scaffold dependency-freshness updater (design §9.3).
 *
 * Keeps the scaffolder's pinned versions current so the lockfile-frozen
 * experience matches a fresh install. Bumps:
 *   1. the central `dependencyVersionMap` in `src/scaffolder.ts`, and
 *   2. every template's `package.json` (`templates/<runtime>/package.json`)
 * to the latest version compatible with each existing caret range.
 *
 * It only touches caret ranges (`^x.y.z`): the safe, semver-compatible bumps.
 * Sentinel pins are left ALONE on purpose:
 *   - `latest` (QUESTPIE workspace packages — always resolve newest at install)
 *   - exact pins / pre-release builds (e.g. `1.0.0-beta.6-4414a19`)
 *   - non-range specifiers (workspace:, file:, git+, http)
 *
 * Run periodically (CI cron / Renovate / a scheduled agent). Each bump MUST be
 * verified by the boot-test gate (§7 / ACCEPTANCE GATE) before merging — this
 * script only rewrites versions, it does not install or test.
 *
 * Usage:
 *   bun run scripts/update-scaffold-deps.ts            # apply bumps in place
 *   bun run scripts/update-scaffold-deps.ts --dry-run  # print, write nothing
 */

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PKG_ROOT = join(import.meta.dirname, "..");
const SCAFFOLDER_PATH = join(PKG_ROOT, "src", "scaffolder.ts");
const TEMPLATES_DIR = join(PKG_ROOT, "templates");
const DRY_RUN = process.argv.includes("--dry-run");

/** Matches a caret range like `^1.2.3` / `^1.2.3-beta.4`. */
const CARET_RANGE = /^\^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

const latestCache = new Map<string, string | null>();

/** Resolve the dist-tag `latest` version for a package via `npm view`. */
function latestVersion(name: string): string | null {
	if (latestCache.has(name)) return latestCache.get(name) ?? null;
	const result = spawnSync("npm", ["view", name, "version"], {
		encoding: "utf-8",
	});
	const version = result.status === 0 ? result.stdout.trim() || null : null;
	if (!version) {
		console.warn(`  ! could not resolve latest for ${name} — skipping`);
	}
	latestCache.set(name, version);
	return version;
}

/**
 * Compute the bumped caret spec for `current`. Returns null when nothing should
 * change (not a caret range, lookup failed, or already current).
 */
function bumpedSpec(name: string, current: string): string | null {
	const match = CARET_RANGE.exec(current);
	if (!match) return null;
	const latest = latestVersion(name);
	if (!latest) return null;
	const next = `^${latest}`;
	return next === current ? null : next;
}

function updateTemplatePackageJson(file: string): number {
	const raw = readFileSync(file, "utf-8");
	const pkg = JSON.parse(raw) as {
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	let changes = 0;
	for (const field of ["dependencies", "devDependencies"] as const) {
		const deps = pkg[field];
		if (!deps) continue;
		for (const [name, current] of Object.entries(deps)) {
			const next = bumpedSpec(name, current);
			if (next) {
				console.log(`  ${name}: ${current} -> ${next}`);
				deps[name] = next;
				changes++;
			}
		}
	}
	if (changes > 0 && !DRY_RUN) {
		writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
	return changes;
}

function updateVersionMap(): number {
	const source = readFileSync(SCAFFOLDER_PATH, "utf-8");
	const start = source.indexOf("const dependencyVersionMap");
	if (start === -1) {
		console.warn("  ! dependencyVersionMap not found in scaffolder.ts");
		return 0;
	}
	const end = source.indexOf("};", start);
	const block = source.slice(start, end);

	let changes = 0;
	// Match `"name": "^x.y.z",` entries inside the map block.
	const entry = /(["']?)([\w@/.-]+)\1:\s*"(\^[^"]+)"/g;
	const rewrittenBlock = block.replace(
		entry,
		(whole, quote: string, name: string, current: string) => {
			const next = bumpedSpec(name, current);
			if (!next) return whole;
			console.log(`  ${name}: ${current} -> ${next}`);
			changes++;
			return `${quote}${name}${quote}: "${next}"`;
		},
	);

	if (changes > 0 && !DRY_RUN) {
		writeFileSync(SCAFFOLDER_PATH, source.replace(block, rewrittenBlock));
	}
	return changes;
}

function main(): void {
	console.log(
		DRY_RUN
			? "Scaffold dep freshness (dry run — no writes)\n"
			: "Scaffold dep freshness\n",
	);

	console.log("dependencyVersionMap (src/scaffolder.ts):");
	const mapChanges = updateVersionMap();
	if (mapChanges === 0) console.log("  up to date");

	let templateChanges = 0;
	for (const entry of readdirSync(TEMPLATES_DIR, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		console.log(`\ntemplates/${entry.name}/package.json:`);
		const changes = updateTemplatePackageJson(
			join(TEMPLATES_DIR, entry.name, "package.json"),
		);
		if (changes === 0) console.log("  up to date");
		templateChanges += changes;
	}

	const total = mapChanges + templateChanges;
	console.log(
		`\n${total} version${total === 1 ? "" : "s"} bumped${
			DRY_RUN ? " (dry run)" : ""
		}.`,
	);
	if (total > 0 && !DRY_RUN) {
		console.log(
			"Next: scaffold a project, install, and run the boot-test gate before merging.",
		);
	}
}

main();
