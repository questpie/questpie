import { doesNotMatch, match, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const root = "docs/v4/prototypes/opentelemetry-ingress-terminal-boundary";
const base = "5a3c9c98702e4d27f9be5ea7c78fcd4af735c26b";
const adrPath =
	"docs/adr/0034-freeze-explicit-ingress-trace-plans-and-response-absent-http-terminals.md";
const adr = readFileSync(adrPath, "utf8");

match(adr, /^- Status: Accepted$/m);
doesNotMatch(adr, /^- Status: Proposed$/m);
match(readFileSync("docs/adr/README.md", "utf8"), /0034-/u);
match(readFileSync("SPEC.md", "utf8"), /it carries explicit null/u);
match(readFileSync("CONTEXT.md", "utf8"), /Response-absent HTTP Terminal/u);
match(readFileSync("HANDOFF.md", "utf8"), /ADR-0034 is Accepted/u);
strictEqual(existsSync(`${root}/REVIEW.json`), true);
strictEqual(existsSync(`${root}/REVIEW-REPLACEMENT.json`), true);
const blockedReviewBytes = readFileSync(`${root}/REVIEW.json`);
strictEqual(
	createHash("sha256").update(blockedReviewBytes).digest("hex"),
	"f4248c3c16ef079fb854068044d357fd700930cf94f59ff310cb2600ec38e94c",
);
const blockedReview = JSON.parse(blockedReviewBytes.toString()) as Readonly<{
	reviewedHead: string;
	verdict: string;
}>;
strictEqual(
	blockedReview.reviewedHead,
	"9afe302ab59c67f13716d0a6412a8c83122d75b4",
);
strictEqual(blockedReview.verdict, "BLOCKED");
const acceptedReviewBytes = readFileSync(`${root}/REVIEW-REPLACEMENT.json`);
strictEqual(
	createHash("sha256").update(acceptedReviewBytes).digest("hex"),
	"68fd15ea30b9c5819c4f35da52489ee94d910e314b0ef56b086ae5199617a5c1",
);
const acceptedReview = JSON.parse(acceptedReviewBytes.toString()) as Readonly<{
	reviewedHead: string;
	verdict: string;
}>;
strictEqual(
	acceptedReview.reviewedHead,
	"c6cce528ed837305ba816e2a83e0e4ebc593798f",
);
strictEqual(acceptedReview.verdict, "PASS");

const verified = Bun.spawnSync(
	[
		"bun",
		"run",
		"review:accept:verify",
		"--",
		"--record",
		`${root}/REVIEW-REPLACEMENT.json`,
	],
	{ stderr: "pipe", stdout: "pipe" },
);
strictEqual(verified.exitCode, 0, verified.stderr.toString());

const changed = Bun.spawnSync(["git", "diff", "--name-only", `${base}..HEAD`], {
	stderr: "pipe",
	stdout: "pipe",
});
strictEqual(changed.exitCode, 0, changed.stderr.toString());
for (const path of changed.stdout.toString().trim().split("\n").filter(Boolean))
	strictEqual(
		path === adrPath ||
			path.startsWith(`${root}/`) ||
			[
				"CONTEXT.md",
				"HANDOFF.md",
				"SPEC.md",
				"docs/adr/README.md",
				"docs/v4/implementation/opentelemetry/README.md",
			].includes(path),
		true,
		`candidate changed an out-of-scope path: ${path}`,
	);

const candidate = [
	adr,
	...["CANDIDATES.md", "README.md", "kernel.test.ts", "kernel.ts"].map((path) =>
		readFileSync(`${root}/${path}`, "utf8"),
	),
].join("\n");
doesNotMatch(candidate, /\bfallbacks?\b/iu);
match(candidate, /IngressTracePlanV1/u);
match(candidate, /httpResponseStatusCode: null/u);
match(candidate, /no `Response` existed/u);
match(candidate, /No old\s+decoder or dual path remains/iu);

console.log("OpenTelemetry ingress/terminal candidate staging: PASS");
