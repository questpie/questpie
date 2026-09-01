import { deepStrictEqual, doesNotMatch, match, strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const acceptedAuthority = Object.freeze({
	"CONTEXT.md":
		"99aa67eb8e667ae091401c3eb264144d8a3a660a586d6fe09ad037c27927efb6",
	"HANDOFF.md":
		"237c17994f1bf78cb95d1b2c8c16c472a92395b2491821d77dc8a64aa5b82304",
	"SPEC.md": "c6b15dcb82e020be32b55ab432547d0e722513d01af602cbdd8d59c48326ae26",
	"docs/adr/README.md":
		"6f65e52dbda74c67d10721b7b1f6e9adb58f8b46c1483b371f4c0367702bd675",
	"docs/v4/live-query-and-change-ledger.md":
		"e5bed2ef783c7019a17083f779ace6e6004eb33a7fe23f057ee9e949e82c2ea8",
	"docs/v4/semantic-kernels-and-public-surface.md":
		"36d44b200920aad36b831b651a08bba4e74c952feca6ccf2085df267bbad748d",
});

const actualAuthority = Object.fromEntries(
	Object.keys(acceptedAuthority).map((path) => [
		path,
		createHash("sha256").update(readFileSync(path)).digest("hex"),
	]),
);
deepStrictEqual(actualAuthority, acceptedAuthority);

const adr = readFileSync(
	"docs/adr/0035-freeze-query-resource-and-react-client-integration.md",
	"utf8",
);
match(adr, /^- Status: Proposed$/m);
doesNotMatch(adr, /^- Status: Accepted$/m);
match(adr, /Only a compiler-proven watchable generated Query method gains/u);
match(adr, /Different client instances or Context\s+scopes never share/u);
match(adr, /The registry retains at most 128 resource identities/u);
match(adr, /exact peer `questpie: 4\.0\.0-beta\.1`/u);
match(adr, /no Suspense contract, server\s+snapshot, SSR, hydration/u);
match(adr, /does not guess writes from a Mutation name/u);
match(adr, /It is not a Relation/u);

const index = readFileSync("docs/adr/README.md", "utf8");
doesNotMatch(index, /^35\. /m);
doesNotMatch(index, /ADR-0035/u);
for (const path of ["SPEC.md", "CONTEXT.md", "HANDOFF.md"])
	doesNotMatch(readFileSync(path, "utf8"), /ADR-0035|Query Resource/u);

const publicDraft = readFileSync(
	"docs/v4/prototypes/reactive-client-integration/PUBLIC-DRAFT.md",
	"utf8",
);
match(publicDraft, /not current product authority/u);
match(publicDraft, /useQueryResource/u);
match(publicDraft, /not a QUESTPIE Relation/u);

const candidateSpec = readFileSync(
	"docs/v4/prototypes/reactive-client-integration/SPEC.md",
	"utf8",
);
match(candidateSpec, /Status: Proposed executable contract/u);
match(candidateSpec, /No fallback cache, poller, one-shot call/u);
doesNotMatch(candidateSpec, /TanStack Query owns|automatic invalidation/u);

const manifest = JSON.parse(
	readFileSync(
		"docs/v4/prototypes/reactive-client-integration/acceptance-manifest.json",
		"utf8",
	),
) as Readonly<{
	protocolVersion: number;
	diffBase: string;
	reviewOutput: string;
	authorityDocuments: ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
	verification: ReadonlyArray<Readonly<{ command: string; result: string }>>;
}>;
strictEqual(manifest.protocolVersion, 2);
strictEqual(manifest.diffBase, "efd835a073ae33e4dfa3f5bef2cf2cad8c46c393");
strictEqual(
	manifest.reviewOutput,
	"docs/v4/prototypes/reactive-client-integration/REVIEW.json",
);
for (const document of manifest.authorityDocuments)
	strictEqual(
		createHash("sha256").update(readFileSync(document.path)).digest("hex"),
		document.sha256,
		`stale authority hash: ${document.path}`,
	);
for (const gate of manifest.verification) strictEqual(gate.result, "PASS");

console.log("reactive client integration acceptance staging: PASS");
