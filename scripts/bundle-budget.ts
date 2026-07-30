/**
 * Consumer bundle budget — what a browser actually downloads.
 *
 * `scripts/size-budget.ts` measures what npm ships. That is a different number
 * and it misses the wins that matter most to an app: moving CRDT off the default
 * client path cut 189 KB from every browser bundle while the published package
 * got very slightly BIGGER, because the code still ships, it just left the
 * import graph. Dropping `qs` cut another 90 KB with no package-size change
 * either. Neither would have been caught here without this gate.
 *
 * Measured with esbuild and **`--splitting` on**, which is what Vite, Rollup,
 * webpack and Next all do. Without it esbuild emits a single file and INLINES
 * dynamic imports, so a correctly lazy dependency looks like part of the entry.
 * That mistake was made once already and produced a report claiming `pusher-js`
 * shipped to every app when it is in its own lazy chunk. The gate therefore
 * scores the ENTRY chunk only.
 *
 * Usage:
 *   bun run scripts/bundle-budget.ts            # check against budget
 *   bun run scripts/bundle-budget.ts --update   # rewrite budget from current state
 *
 * Requires a prior build of the packages under test.
 */

import { execFile } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = join(import.meta.dirname, "..");
const BUDGET_PATH = join(ROOT, "scripts", "bundle-budget.json");
/** Fail when the entry chunk exceeds budget by more than this ratio. */
const TOLERANCE = 0.03;

interface Entry {
	/** Budget key, and the label in the report. */
	name: string;
	/** Import statement the probe file contains. */
	source: string;
}

/**
 * Each entry is a realistic import shape, not a synthetic one. `client` is what
 * every app that talks to QUESTPIE from a browser writes; `client+crdt` exists
 * so the collaborative path is measured rather than silently growing.
 */
const ENTRIES: Entry[] = [
	{
		name: "questpie/client",
		source: `import { createClient } from "questpie/client";\nconsole.log(typeof createClient);\n`,
	},
	{
		name: "questpie/client+crdt",
		source: `import { createClient } from "questpie/client";\nimport { createCrdtClient } from "questpie/crdt";\nconsole.log(typeof createClient, typeof createCrdtClient);\n`,
	},
];

interface Metrics {
	/** Bytes of the entry chunk — what the browser downloads before anything else. */
	entryBytes: number;
	/** Total across every emitted chunk, including lazy ones. Informational. */
	totalBytes: number;
}

interface Budget {
	$comment: string;
	entries: Record<string, Metrics>;
}

async function measure(entry: Entry, workspace: string): Promise<Metrics> {
	const probeDir = join(workspace, entry.name.replace(/[^a-z0-9]+/gi, "-"));
	const outDir = join(probeDir, "out");
	mkdirSync(outDir, { recursive: true });
	const probe = join(probeDir, "probe.mjs");
	writeFileSync(probe, entry.source);

	await execFileAsync(
		"bunx",
		[
			"esbuild",
			probe,
			"--bundle",
			"--format=esm",
			"--platform=browser",
			// The whole point — see the module comment.
			"--splitting",
			`--outdir=${outDir}`,
			`--metafile=${join(probeDir, "meta.json")}`,
			"--log-level=error",
		],
		{ cwd: ROOT, maxBuffer: 64 * 1024 * 1024 },
	);

	const meta = JSON.parse(
		readFileSync(join(probeDir, "meta.json"), "utf8"),
	) as { outputs: Record<string, { bytes: number; entryPoint?: string }> };

	// CAREFUL: esbuild sets `entryPoint` on LAZY chunks too — a dynamically
	// imported module is the entry point of its own chunk. Taking "the output
	// with an entryPoint" therefore picks up whichever lazy chunk comes last,
	// which in this repo is pusher-js and is almost exactly the size of the
	// real entry, so the mistake does not look like one. Match the probe path.
	const probeSuffix = probe.replace(/^.*\//, "");
	let entryBytes = 0;
	let totalBytes = 0;
	for (const output of Object.values(meta.outputs)) {
		totalBytes += output.bytes;
		if (output.entryPoint?.endsWith(probeSuffix)) entryBytes = output.bytes;
	}
	if (entryBytes === 0) {
		console.error(`✗ ${entry.name}: esbuild reported no entry chunk`);
		process.exit(1);
	}
	return { entryBytes, totalBytes };
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

const update = process.argv.includes("--update");

// The probe resolves `questpie` through node_modules, so it must run somewhere
// that can see the workspace. A temp dir with a symlink keeps the repo clean.
const workspace = mkdtempSync(join(tmpdir(), "questpie-bundle-budget-"));
try {
	mkdirSync(join(workspace, "node_modules"), { recursive: true });
	writeFileSync(
		join(workspace, "package.json"),
		`{"name":"bundle-budget-probe","type":"module","private":true}\n`,
	);
	await execFileAsync("ln", [
		"-s",
		join(ROOT, "packages", "questpie"),
		join(workspace, "node_modules", "questpie"),
	]);

	const current: Record<string, Metrics> = {};
	for (const entry of ENTRIES) {
		current[entry.name] = await measure(entry, workspace);
	}

	const nameWidth = Math.max(...ENTRIES.map((e) => e.name.length)) + 2;
	const pad = (s: string, n: number) => s.padEnd(n);
	console.log(`${pad("entry", nameWidth)}${pad("entry chunk", 14)}all chunks`);
	for (const entry of ENTRIES) {
		const m = current[entry.name];
		console.log(
			`${pad(entry.name, nameWidth)}${pad(kb(m.entryBytes), 14)}${kb(m.totalBytes)}`,
		);
	}

	if (update) {
		const budget: Budget = {
			$comment:
				"Consumer bundle budget — the ENTRY chunk a browser downloads, measured with esbuild --splitting (what real bundlers do). Distinct from scripts/size-budget.json, which measures what npm publishes; a dependency moved behind a dynamic import shrinks this and not that. Regenerate with `bun run scripts/bundle-budget.ts --update` after a build. Gate: entry chunk >3% over budget fails CI.",
			entries: current,
		};
		writeFileSync(BUDGET_PATH, `${JSON.stringify(budget, null, "\t")}\n`);
		console.log(`\n✓ wrote ${BUDGET_PATH}`);
		process.exit(0);
	}

	const budget: Budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));

	let failed = false;
	console.log("");
	for (const entry of ENTRIES) {
		const want = budget.entries[entry.name];
		const got = current[entry.name];
		if (!want) {
			console.error(`✗ ${entry.name}: missing from budget — run with --update`);
			failed = true;
			continue;
		}
		const limit = Math.round(want.entryBytes * (1 + TOLERANCE));
		const delta = ((got.entryBytes - want.entryBytes) / want.entryBytes) * 100;
		const deltaStr = `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`;
		if (got.entryBytes > limit) {
			console.error(
				`✗ ${entry.name}: entry chunk ${kb(got.entryBytes)} exceeds budget ${kb(want.entryBytes)} by ${deltaStr} (limit ${kb(limit)})`,
			);
			failed = true;
		} else if (got.entryBytes < want.entryBytes) {
			console.log(
				`✓ ${entry.name}: ${deltaStr} under budget — ratchet it down with --update`,
			);
		}
	}

	if (failed) {
		console.error(
			"\nbundle-budget failed: the browser entry chunk grew. Something that used to be lazy (or absent) is now reachable from the top-level import graph — check for a new static import of an optional dependency, which is how CRDT and pusher-js each cost ~170 KB before.",
		);
		process.exit(1);
	}
	console.log("\n✓ bundle budget within limits");
} finally {
	rmSync(workspace, { recursive: true, force: true });
}
