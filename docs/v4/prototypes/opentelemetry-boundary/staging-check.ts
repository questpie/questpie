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
	postPassChanges: ReadonlyArray<Readonly<{ path: string }>>;
	postImplementationTracerChanges: ReadonlyArray<Readonly<{ path: string }>>;
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
strictEqual(
	projection.postPassChanges.some(({ path }) => path.startsWith("apps/docs/")),
	false,
	"acceptance projection must not publish unimplemented public instructions",
);
deepStrictEqual(
	projection.postImplementationTracerChanges.map(({ path }) => path).sort(),
	[
		"apps/docs/content/docs/v4/beta1-release.mdx",
		"apps/docs/content/docs/v4/durable-reactions.mdx",
		"apps/docs/content/docs/v4/meta.json",
		"apps/docs/content/docs/v4/opentelemetry.mdx",
		"apps/docs/content/docs/v4/runtime-and-studio.mdx",
	],
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
	"replace only the private Runtime events input",
	"do not add a second observation kernel",
	"protocol v8 refuses v7",
	"replace the protocol-v7 compiler catalog",
	"replace --allow-non-rolling-protocol-v7",
	"replace protocol-v7 readiness",
	"replace the protocol version 7 bundle contract",
	"version mismatch",
];
for (const fact of expectedBreakingFacts)
	strictEqual(
		projection.breakingDeletions.some((entry) => entry.includes(fact)),
		true,
		`missing breaking deletion: ${fact}`,
	);

for (const path of [
	"packages/runtime/src/bundle-core-types.d.ts",
	"tests/unit/pb05-runtime-bundle-completeness.test.ts",
])
	strictEqual(
		projection.unchangedBeforePass.some((file) => file.path === path),
		true,
		`missing unchanged bundle owner: ${path}`,
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
match(candidateText, /no v1\s+compatibility event/u);
match(candidateText, /non-rolling/u);
match(candidateText, /telemetry defects never\s+replace it/iu);
match(
	candidateText,
	/generated declarations import that core-owned type only/iu,
);
match(candidateText, /null supplies zero links/iu);
match(candidateText, /rejected for either non-ratio sampler/iu);
match(candidateText, /QP-START-004 telemetryUnavailable/u);
match(candidateText, /QP-START-004\s+telemetryInvalidConfiguration/u);
match(candidateText, /SIGINT\/SIGTERM.*close the App, then close telemetry/su);

const productionEventSource = readFileSync(
	"packages/runtime/src/application/events.ts",
	"utf8",
);
match(productionEventSource, /ExecutionEventV1/u);
doesNotMatch(productionEventSource, /ExecutionEventV2/u);
const generatedSource = readFileSync(
	"packages/compiler/src/generate.ts",
	"utf8",
);
const generatedCreateInput = generatedSource.slice(
	generatedSource.indexOf("export type CreateAppInput"),
	generatedSource.indexOf("export async function createApp"),
);
doesNotMatch(generatedCreateInput, /events\??:/u);
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
