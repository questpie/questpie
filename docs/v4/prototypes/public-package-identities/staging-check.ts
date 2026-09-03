import { expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../../..");
const read = (path: string): string =>
	readFileSync(resolve(root, path), "utf8");

type Projection = Readonly<{
	status: string;
	decision: string;
	acceptedProjection: readonly string[];
	breakingImplementation: readonly string[];
	frozenEvidence: readonly string[];
}>;

const projection = JSON.parse(
	read(
		"docs/v4/prototypes/public-package-identities/authority-projection.json",
	),
) as Projection;

expect(projection.status).toBe("proposed");
expect(projection.decision).toBe(
	"docs/adr/0042-freeze-public-package-identities.md",
);
expect(read(projection.decision)).toContain("- Status: Proposed");
expect(read("docs/adr/README.md")).toContain(
	"## Proposed\n\n- [Slice the beta.2 DX release]",
);
expect(read("docs/adr/README.md")).toContain(
	"- [Freeze public package identities](./0042-freeze-public-package-identities.md)",
);
expect(read("SPEC.md")).toContain(
	"`questpie`, `@questpie/react`, and\n`@questpie/opentelemetry`",
);
expect(read("CONTEXT.md")).toContain("`@questpie/opentelemetry`");
expect(read("HANDOFF.md")).toContain("`@questpie/react`");
expect(read("packages/react/package.json")).toContain(
	'"name": "@questpie/react"',
);
expect(read("packages/opentelemetry/package.json")).toContain(
	'"name": "@questpie/opentelemetry"',
);
expect(existsSync(resolve(import.meta.dir, "REVIEW.json"))).toBe(false);

for (const paths of [
	projection.acceptedProjection,
	projection.breakingImplementation,
]) {
	expect(new Set(paths).size).toBe(paths.length);
	for (const path of paths)
		expect(existsSync(resolve(root, path)), path).toBe(true);
}

expect(projection.frozenEvidence).toEqual([
	"docs/v4/prototypes/opentelemetry-boundary/",
	"docs/v4/prototypes/reactive-client-integration/",
	"docs/v4/research/",
	"docs/v4/implementation/**/REVIEW*.json",
]);

const oldNameScan = Bun.spawnSync(
	["git", "grep", "-Il", "-E", "@questpie/(react|opentelemetry)", "HEAD"],
	{ cwd: root, stderr: "pipe", stdout: "pipe" },
);
expect(oldNameScan.exitCode, oldNameScan.stderr?.toString() ?? "").toBe(0);

const trackedOldNameFiles = (oldNameScan.stdout?.toString() ?? "")
	.trim()
	.split("\n")
	.map((line) => line.replace(/^HEAD:/, ""));
const accounted = new Set([
	...projection.acceptedProjection,
	...projection.breakingImplementation,
]);
const frozen = (path: string): boolean =>
	path.startsWith("docs/v4/prototypes/opentelemetry-boundary/") ||
	path.startsWith("docs/v4/prototypes/reactive-client-integration/") ||
	path.startsWith("docs/v4/research/") ||
	/^docs\/v4\/implementation\/.*\/REVIEW.*\.json$/.test(path);
const unaccounted = trackedOldNameFiles.filter(
	(path) => !accounted.has(path) && !frozen(path),
);
expect(unaccounted).toEqual([]);

console.log("public package identity candidate staging: PASS");
