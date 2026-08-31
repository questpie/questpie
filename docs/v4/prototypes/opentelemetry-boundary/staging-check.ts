import { deepStrictEqual, doesNotMatch, match, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const root = "docs/v4/prototypes/opentelemetry-boundary";
const projection = JSON.parse(
	readFileSync(`${root}/authority-projection.json`, "utf8"),
) as Readonly<{
	base: string;
	status: string;
	publicDraft: Readonly<{ source: string; sha256: string }>;
	unchangedBeforePass: ReadonlyArray<
		Readonly<{ path: string; sha256: string }>
	>;
	breakingDeletions: readonly string[];
}>;

const digest = (path: string) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");

strictEqual(projection.base, "efd835a073ae33e4dfa3f5bef2cf2cad8c46c393");
strictEqual(projection.status, "candidate-only-until-verified-pass");
for (const file of projection.unchangedBeforePass)
	strictEqual(
		digest(file.path),
		file.sha256,
		`premature projection: ${file.path}`,
	);
strictEqual(
	digest(projection.publicDraft.source),
	projection.publicDraft.sha256,
	"public draft hash changed without refreshing its projection binding",
);

const adr = readFileSync(
	"docs/adr/0033-freeze-runtime-observation-and-opentelemetry-projection.md",
	"utf8",
);
match(adr, /^- Status: Proposed$/m);
doesNotMatch(adr, /^- Status: Accepted$/m);
doesNotMatch(readFileSync("docs/adr/README.md", "utf8"), /ADR-0033|0033-/u);
strictEqual(existsSync(`${root}/REVIEW.json`), false);

const candidatePaths = Bun.spawnSync(
	["git", "diff", "--name-only", `${projection.base}..HEAD`],
	{ stdout: "pipe", stderr: "pipe" },
);
strictEqual(candidatePaths.exitCode, 0, candidatePaths.stderr.toString());
const paths = candidatePaths.stdout
	.toString()
	.trim()
	.split("\n")
	.filter(Boolean);
for (const path of paths)
	strictEqual(
		path ===
			"docs/adr/0033-freeze-runtime-observation-and-opentelemetry-projection.md" ||
			path.startsWith(`${root}/`),
		true,
		`candidate changed live authority or production: ${path}`,
	);

const expectedBreakingFacts = [
	"delete ExecutionEventV1",
	"replace the events CreateAppInput type atomically",
	"do not add a second observation kernel",
	"protocol v8 refuses v7",
	"version mismatch",
];
for (const fact of expectedBreakingFacts)
	strictEqual(
		projection.breakingDeletions.some((entry) => entry.includes(fact)),
		true,
		`missing breaking deletion: ${fact}`,
	);

const candidateText = [
	adr,
	...[
		"ADVERSARIAL-REVIEWS.md",
		"BOUNDARY.md",
		"CANDIDATE.md",
		"CANDIDATES.md",
		"PUBLIC-DRAFT.md",
		"README.md",
		"SIGNALS.md",
	].map((path) => readFileSync(`${root}/${path}`, "utf8")),
].join("\n");
doesNotMatch(candidateText, /\bfallbacks?\b/iu);
match(candidateText, /no v1 compatibility event/u);
match(candidateText, /non-rolling/u);
match(candidateText, /telemetry defects never\s+replace it/iu);

const productionEventSource = readFileSync(
	"packages/runtime/src/application/events.ts",
	"utf8",
);
match(productionEventSource, /ExecutionEventV1/u);
doesNotMatch(productionEventSource, /ExecutionEventV2/u);
const corePackage = JSON.parse(
	readFileSync("packages/questpie/package.json", "utf8"),
) as Readonly<{ dependencies?: Readonly<Record<string, string>> }>;
deepStrictEqual(
	Object.keys(corePackage.dependencies ?? {}).filter((name) =>
		name.startsWith("@opentelemetry/"),
	),
	[],
);

console.log("OpenTelemetry candidate staging: PASS");
