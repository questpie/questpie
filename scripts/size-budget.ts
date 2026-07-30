/**
 * Package-size budget gate — keeps published bloat under control.
 *
 * Every byte in a published package is paid for by every consumer, forever.
 * This gate measures what npm would actually ship (`npm pack --dry-run`, so the
 * `files` field and .npmignore are respected — not `du` on dist/, which counts
 * artefacts that never leave the machine) and compares it against the committed
 * budget in scripts/size-budget.json.
 *
 * Packages are DISCOVERED from packages/* — any non-private package.json is
 * measured. Same rule as scripts/any-census.ts, and for the same reason: a
 * hardcoded list is how things quietly stop being measured.
 *
 * Requires a prior build. Run it after `turbo run build --filter='./packages/*'`;
 * a package whose dist/ is stale will report a stale number, and one that was
 * never built will usually collapse to a few KB and fail loudly rather than
 * silently pass.
 *
 * Usage:
 *   bun run scripts/size-budget.ts            # check against budget
 *   bun run scripts/size-budget.ts --update   # rewrite budget from current state
 *
 * Notes:
 * - The gate is on `unpackedSize` (what lands in node_modules), not the gzipped
 *   tarball. Tarball size moves with compressibility; unpacked size is what
 *   costs disk, install time, and cold-start file reads.
 * - `entryCount` is recorded and reported but NOT gated: splitting one module
 *   into three is not a regression.
 * - TOLERANCE is 5%, paired with MIN_GROWTH_BYTES below — both conditions must
 *   hold. Build output is near-deterministic for a fixed toolchain, so a jump
 *   that clears both is a real change in what ships, not measurement noise.
 */

import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dirname, "..");
const BUDGET_PATH = join(ROOT, "scripts", "size-budget.json");
/** Fail when unpacked size exceeds budget by more than this ratio. */
const TOLERANCE = 0.05;
/**
 * …and by more than this many bytes. Both conditions must hold.
 *
 * A percentage alone is unusable on the small packages: `@questpie/next` is
 * 6 KB and `@questpie/observability` 9 KB, where 5% is a few hundred bytes and
 * adding one JSDoc block to a public option trips the gate. That happened on
 * 2026-07-29 and it is exactly how a gate earns a reputation for crying wolf —
 * the lint job in this repo sat commented out for months for the same reason.
 * A genuine regression on a package this size (a dependency getting bundled in,
 * tests leaking past `files`) is orders of magnitude past 1 KB, so the floor
 * costs no real coverage.
 */
const MIN_GROWTH_BYTES = 1024;

interface Metrics {
	unpackedSize: number;
	entryCount: number;
}

interface Budget {
	$comment: string;
	targets: Record<string, Metrics>;
}

/** Non-private `packages/*` — discovered, never hand-listed. */
function discoverPackages(): string[] {
	const packagesDir = join(ROOT, "packages");
	return readdirSync(packagesDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) => {
			const manifest = join(packagesDir, name, "package.json");
			if (!existsSync(manifest)) return false;
			try {
				return JSON.parse(readFileSync(manifest, "utf8")).private !== true;
			} catch {
				return false;
			}
		})
		.sort();
}

/**
 * `npm pack` is the authoritative measure (it honours `files`/.npmignore), but
 * it is slow — a serial pass over 14 packages takes minutes on a loaded
 * machine. The calls are independent, so run them concurrently; wall time
 * becomes the slowest single package.
 *
 * `bun pm pack --dry-run` is ~1.4s but only prints rounded human sizes
 * ("57.65KB") with no --json, which would bake imprecision into the committed
 * budget. Exact bytes are worth the concurrency.
 */
async function measure(pkg: string): Promise<Metrics> {
	const cwd = join(ROOT, "packages", pkg);
	let stdout = "";
	let stderr = "";
	try {
		const res = await execFileAsync("npm", ["pack", "--dry-run", "--json"], {
			cwd,
			encoding: "utf8",
			maxBuffer: 64 * 1024 * 1024,
		});
		stdout = res.stdout;
		stderr = res.stderr;
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string };
		stdout = e.stdout ?? "";
		stderr = e.stderr ?? "";
	}
	// npm prints the tarball listing to stderr and the JSON to stdout, but a
	// warning can still precede it — take the first well-formed array.
	const start = stdout.indexOf("[");
	if (start === -1) {
		console.error(`✗ ${pkg}: npm pack produced no JSON`);
		console.error(stderr.slice(-2000));
		process.exit(1);
	}
	let parsed: Array<{ unpackedSize?: number; entryCount?: number }>;
	try {
		parsed = JSON.parse(stdout.slice(start));
	} catch {
		console.error(`✗ ${pkg}: could not parse npm pack --json output`);
		console.error(stdout.slice(-2000));
		process.exit(1);
	}
	const entry = parsed[0];
	if (!entry?.unpackedSize) {
		console.error(`✗ ${pkg}: npm pack reported no unpackedSize — is it built?`);
		process.exit(1);
	}
	return {
		unpackedSize: entry.unpackedSize,
		entryCount: entry.entryCount ?? 0,
	};
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

const update = process.argv.includes("--update");
const PACKAGES = discoverPackages();
const current: Record<string, Metrics> = {};

const measured = await Promise.all(PACKAGES.map((pkg) => measure(pkg)));
PACKAGES.forEach((pkg, i) => {
	current[pkg] = measured[i];
});

const nameWidth = Math.max(8, ...PACKAGES.map((p) => p.length)) + 2;
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`${pad("package", nameWidth)}${pad("unpacked", 12)}entries`);
for (const pkg of PACKAGES) {
	console.log(
		`${pad(pkg, nameWidth)}${pad(kb(current[pkg].unpackedSize), 12)}${current[pkg].entryCount}`,
	);
}
const total = Object.values(current).reduce((a, m) => a + m.unpackedSize, 0);
console.log(`${pad("TOTAL", nameWidth)}${kb(total)}`);

if (update) {
	const budget: Budget = {
		$comment:
			"Published package-size budget (npm pack --dry-run unpackedSize, so `files`/.npmignore are respected). Packages are DISCOVERED from packages/* — never hand-edit the list. Regenerate with `bun run scripts/size-budget.ts --update` after a build, and review the diff. Gate: unpackedSize >5% over budget fails CI. entryCount is informational only.",
		targets: current,
	};
	writeFileSync(BUDGET_PATH, `${JSON.stringify(budget, null, "\t")}\n`);
	console.log(`\n✓ wrote ${BUDGET_PATH}`);
	process.exit(0);
}

const budget: Budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));

let failed = false;
let unbudgeted = false;
console.log("");
for (const pkg of PACKAGES) {
	const want = budget.targets[pkg];
	const got = current[pkg];
	if (!want) {
		console.error(`✗ ${pkg}: missing from budget — run with --update`);
		failed = true;
		unbudgeted = true;
		continue;
	}
	// Both gates, not either: the ratio catches proportional bloat on the big
	// packages, the byte floor stops the small ones failing on a comment.
	const limit = Math.max(
		Math.round(want.unpackedSize * (1 + TOLERANCE)),
		want.unpackedSize + MIN_GROWTH_BYTES,
	);
	const growth = got.unpackedSize - want.unpackedSize;
	const delta =
		((got.unpackedSize - want.unpackedSize) / want.unpackedSize) * 100;
	const deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
	if (got.unpackedSize > limit) {
		console.error(
			`✗ ${pkg}: ${kb(got.unpackedSize)} exceeds budget ${kb(want.unpackedSize)} by ${deltaStr} (+${growth} bytes; limit ${kb(limit)})`,
		);
		failed = true;
	} else if (got.unpackedSize < want.unpackedSize) {
		console.log(
			`✓ ${pkg}: ${deltaStr} under budget — ratchet it down with --update`,
		);
	}
}

// A budget entry with no package on disk is stale — harmless for the gate, but
// it means the committed JSON has drifted from reality.
for (const pkg of Object.keys(budget.targets)) {
	if (!PACKAGES.includes(pkg)) {
		console.warn(
			`! ${pkg}: in budget but not on disk — re-baseline to drop it`,
		);
	}
}

if (failed) {
	console.error(
		unbudgeted
			? "\nsize-budget failed: a non-private package under packages/* has no budget entry. Review its size above and lock it in with `bun run scripts/size-budget.ts --update`."
			: "\nsize-budget failed: published output grew. Every byte here ships to every consumer — check what was added (a new dependency bundled in, a subsystem that should be a separate entrypoint, source maps or tests leaking past the `files` field) before re-baselining with --update.",
	);
	process.exit(1);
}
console.log("\n✓ size budget within limits");
