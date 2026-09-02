import {
	deepStrictEqual,
	doesNotMatch,
	match,
	notStrictEqual,
	strictEqual,
} from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const root = "docs/v4/prototypes/opentelemetry-boundary";
const projection = JSON.parse(
	readFileSync(`${root}/authority-projection.json`, "utf8"),
) as Readonly<{
	base: string;
	status: string;
	acceptance: Readonly<{
		record: string;
		sha256: string;
		reviewedHead: string;
		recordCommit: string;
		verdict: string;
	}>;
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
strictEqual(projection.status, "accepted-unimplemented-spec-tickets-next");
const postPassPaths = new Set(
	projection.postPassChanges.map(({ path }) => path),
);
for (const file of projection.unchangedBeforePass) {
	if (postPassPaths.has(file.path))
		notStrictEqual(
			digest(file.path),
			file.sha256,
			`missing Accepted authority projection: ${file.path}`,
		);
	else
		strictEqual(
			digest(file.path),
			file.sha256,
			`unplanned post-acceptance change: ${file.path}`,
		);
}
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
match(adr, /^- Status: Accepted$/m);
doesNotMatch(adr, /^- Status: Proposed$/m);
match(readFileSync("docs/adr/README.md", "utf8"), /0033-/u);
strictEqual(existsSync(`${root}/REVIEW.json`), true);
strictEqual(
	digest(`${root}/REVIEW.json`),
	"1644adc531b6444286fbaf8e113cd0650ae97f2520a8a7fbd51965ca2056c143",
);
const blockedReview = JSON.parse(
	readFileSync(`${root}/REVIEW.json`, "utf8"),
) as Readonly<{
	reviewedHead: string;
	verdict: string;
	primary: Readonly<{ disposition: string }>;
}>;
strictEqual(
	blockedReview.reviewedHead,
	"bddada48b6c62795a77b005de397f351d1138cf9",
);
strictEqual(blockedReview.verdict, "BLOCKED");
strictEqual(blockedReview.primary.disposition, "BLOCKED");
strictEqual(existsSync(projection.acceptance.record), true);
strictEqual(digest(projection.acceptance.record), projection.acceptance.sha256);
strictEqual(
	projection.acceptance.reviewedHead,
	"c3bd1a2d337e6142013fe79ab5b78fca0fe327e0",
);
strictEqual(
	projection.acceptance.recordCommit,
	"17ee8898af956c838b3f62b8a34cccd23e365b92",
);
strictEqual(projection.acceptance.verdict, "PASS");
const recordCommitIsAncestor = Bun.spawnSync(
	[
		"git",
		"merge-base",
		"--is-ancestor",
		projection.acceptance.recordCommit,
		"HEAD",
	],
	{ stdout: "pipe", stderr: "pipe" },
);
strictEqual(
	recordCommitIsAncestor.exitCode,
	0,
	recordCommitIsAncestor.stderr.toString(),
);
const acceptedReview = JSON.parse(
	readFileSync(projection.acceptance.record, "utf8"),
) as Readonly<{
	reviewedHead: string;
	verdict: string;
	primary: Readonly<{ disposition: string }>;
}>;
strictEqual(acceptedReview.reviewedHead, projection.acceptance.reviewedHead);
strictEqual(acceptedReview.verdict, "PASS");
strictEqual(acceptedReview.primary.disposition, "PASS");

const recordCommit = Bun.spawnSync(
	[
		"git",
		"show",
		`${projection.acceptance.recordCommit}:${projection.acceptance.record}`,
	],
	{ stdout: "pipe", stderr: "pipe" },
);
strictEqual(recordCommit.exitCode, 0, recordCommit.stderr.toString());
strictEqual(
	createHash("sha256").update(recordCommit.stdout).digest("hex"),
	projection.acceptance.sha256,
);
const verified = Bun.spawnSync(
	[
		"bun",
		"run",
		"review:accept:verify",
		"--",
		"--record",
		projection.acceptance.record,
	],
	{ stdout: "pipe", stderr: "pipe" },
);
strictEqual(verified.exitCode, 0, verified.stderr.toString());

const acceptanceManifest = JSON.parse(
	readFileSync(`${root}/acceptance-manifest.json`, "utf8"),
) as Readonly<{
	reviewOutput: string;
	verification: ReadonlyArray<Readonly<{ command: string }>>;
}>;
strictEqual(acceptanceManifest.reviewOutput, `${root}/REVIEW-REPLACEMENT.json`);
strictEqual(
	acceptanceManifest.verification.some(({ command }) =>
		command.includes("PGHOST=127.0.0.1 PGPORT=55439"),
	),
	true,
);

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
			path.startsWith(`${root}/`) ||
			postPassPaths.has(path),
		true,
		`Accepted projection changed an unplanned path: ${path}`,
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

console.log("OpenTelemetry Accepted projection staging: PASS");
