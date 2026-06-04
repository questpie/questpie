/**
 * Audit gate — runs `bun audit --json --audit-level=high`, drops known-and-tracked
 * advisories, and fails the build if anything new shows up.
 *
 * Adding an entry to `KNOWN` is the same operation as snoozing a Linear ticket:
 * you keep the build green right now and commit to fixing it in a follow-up.
 * Always reference the bump PR / issue that will remove the entry.
 */

const KNOWN = new Map<string, string>([
	// h3 middleware bypass — still present via @tanstack/start-server-core's
	// h3-v2@2.0.0-beta.4 (aliased import). Clears when react-start is bumped
	// from 1.136.x to 1.167.42+ across the monorepo (planned follow-up PR).
	["GHSA-3vj8-jmxq-cgj5", "TODO: @tanstack/react-start bump PR"],
	// vitest UI arbitrary file read — affects <4.1.0. Dev dependency only.
	["GHSA-5xrq-8626-4rwp", "TODO: vitest bump to 4.1.0+"],
]);

type Advisory = {
	id: number;
	url: string;
	title: string;
	severity: "low" | "moderate" | "high" | "critical";
	vulnerable_versions: string;
};

const proc = Bun.spawnSync({
	cmd: ["bun", "audit", "--json", "--audit-level=high"],
	stdout: "pipe",
	stderr: "pipe",
});

const stdout = proc.stdout.toString();
if (!stdout.trim()) {
	console.log("✓ No advisories at high or critical severity.");
	process.exit(0);
}

let advisories: Record<string, Advisory[]>;
try {
	advisories = JSON.parse(stdout);
} catch (err) {
	console.error("Could not parse `bun audit --json` output:");
	console.error(stdout);
	console.error(proc.stderr.toString());
	process.exit(1);
}

type Hit = { pkg: string; ghsa: string; advisory: Advisory };
const unhandled: Hit[] = [];
const snoozed: Hit[] = [];

for (const [pkg, advs] of Object.entries(advisories)) {
	for (const advisory of advs) {
		if (advisory.severity !== "high" && advisory.severity !== "critical") {
			continue;
		}
		const ghsa = advisory.url.split("/").pop();
		if (!ghsa) continue;
		const hit: Hit = { pkg, ghsa, advisory };
		if (KNOWN.has(ghsa)) {
			snoozed.push(hit);
		} else {
			unhandled.push(hit);
		}
	}
}

if (snoozed.length > 0) {
	console.log(`Snoozed (tracked in KNOWN, fix pending):`);
	for (const hit of snoozed) {
		console.log(
			`  - ${hit.advisory.severity} ${hit.pkg} ${hit.ghsa} — ${KNOWN.get(hit.ghsa)}`,
		);
	}
	console.log("");
}

if (unhandled.length === 0) {
	console.log("✓ No new high/critical advisories.");
	process.exit(0);
}

console.error(`✗ ${unhandled.length} unhandled high/critical advisor${unhandled.length === 1 ? "y" : "ies"}:\n`);
for (const hit of unhandled) {
	console.error(`  ${hit.advisory.severity.toUpperCase()}  ${hit.pkg}`);
	console.error(`    ${hit.advisory.title}`);
	console.error(`    ${hit.advisory.url}`);
	console.error(`    affected: ${hit.advisory.vulnerable_versions}\n`);
}
console.error(
	"Either bump the affected dependency, or add the GHSA id to KNOWN in scripts/audit-gate.ts\n" +
		"with a note pointing at the follow-up PR. Don't snooze without a follow-up.",
);
process.exit(1);
