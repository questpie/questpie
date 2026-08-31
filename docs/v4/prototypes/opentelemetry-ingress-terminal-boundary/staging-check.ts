import { doesNotMatch, match, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const root = "docs/v4/prototypes/opentelemetry-ingress-terminal-boundary";
const base = "5a3c9c98702e4d27f9be5ea7c78fcd4af735c26b";
const adrPath =
	"docs/adr/0034-freeze-explicit-ingress-trace-plans-and-response-absent-http-terminals.md";
const adr = readFileSync(adrPath, "utf8");

match(adr, /^- Status: Proposed$/m);
doesNotMatch(adr, /^- Status: Accepted$/m);
doesNotMatch(readFileSync("docs/adr/README.md", "utf8"), /0034-/u);
doesNotMatch(readFileSync("SPEC.md", "utf8"), /ADR-0034/u);
doesNotMatch(readFileSync("CONTEXT.md", "utf8"), /ADR-0034/u);
doesNotMatch(readFileSync("HANDOFF.md", "utf8"), /ADR-0034/u);
strictEqual(existsSync(`${root}/REVIEW.json`), true);
strictEqual(existsSync(`${root}/REVIEW-REPLACEMENT.json`), false);
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

const changed = Bun.spawnSync(["git", "diff", "--name-only", `${base}..HEAD`], {
	stderr: "pipe",
	stdout: "pipe",
});
strictEqual(changed.exitCode, 0, changed.stderr.toString());
for (const path of changed.stdout.toString().trim().split("\n").filter(Boolean))
	strictEqual(
		path === adrPath || path.startsWith(`${root}/`),
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
