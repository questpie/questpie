import { deepStrictEqual, doesNotMatch, match, strictEqual } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryFiles = Object.freeze({
	"SPEC.md": "5122452cb43a788c4e67f0f459e0ff81623db354e8e7ca3273dcba1ec33b5c39",
	"CONTEXT.md":
		"4f555830c83894d848d6c55959edd3b9a8fd1785ca6c4587029267aef179420b",
	"HANDOFF.md":
		"0638841203cd7066c37f6be86fc0264031b456831b0070d5978f3c40dd78058e",
	"apps/docs/content/docs/v4/queries-and-mutations.mdx":
		"123a2958a64afbd2425e79e65052d976a641103fd22642bee6855925817982f9",
	"docs/v4/query-mutation-and-lifecycle.md":
		"ef1013cc1073dd10515478a9f0ab3b17a4faeeb13a68d31fcedea938fcf6244b",
	"docs/v4/lifecycle-jobs-and-shared-durable-kernel.md":
		"fab3e6c2307a5728ba3695e98888e1aae2a9730c7d12aa7da7bf338d706b415d",
	"docs/v4/executable-definition-compiler.md":
		"65d53951005b5c03f42c8ccfb4a7a10e82651a88a8b5dd3d25bc2c5c65bc5981",
});

const actualHashes = Object.fromEntries(
	Object.keys(repositoryFiles).map((path) => [
		path,
		createHash("sha256").update(readFileSync(path)).digest("hex"),
	]),
);
deepStrictEqual(actualHashes, repositoryFiles);

const adr = readFileSync(
	"docs/adr/0031-freeze-collection-lifecycle-programs-and-issue-mapping.md",
	"utf8",
);
match(adr, /^- Status: Proposed$/m);
doesNotMatch(adr, /^- Status: Accepted$/m);

const index = readFileSync("docs/adr/README.md", "utf8");
match(index, /^30\. \[Freeze Collection provenance and trusted values\]/m);
doesNotMatch(index, /^31\. /m);
doesNotMatch(index, /ADR-0031/);

const manifest = JSON.parse(
	readFileSync(
		"docs/v4/prototypes/collection-lifecycle-boundary/acceptance-manifest.json",
		"utf8",
	),
) as Readonly<{
	diffBase: string;
	authorityDocuments: ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
}>;
for (const document of manifest.authorityDocuments)
	strictEqual(
		createHash("sha256").update(readFileSync(document.path)).digest("hex"),
		document.sha256,
		`stale authority hash: ${document.path}`,
	);

const projection = JSON.parse(
	readFileSync(
		"docs/v4/prototypes/collection-lifecycle-boundary/authority-projection.json",
		"utf8",
	),
) as Readonly<{ base: string; lines: readonly string[] }>;
strictEqual(projection.base, manifest.diffBase);
const temporaryIndex = join(
	tmpdir(),
	`questpie-lifecycle-projection-${randomUUID()}.index`,
);
const gitEnvironment = { ...Bun.env, GIT_INDEX_FILE: temporaryIndex };
try {
	const readTree = Bun.spawnSync(["git", "read-tree", manifest.diffBase], {
		env: gitEnvironment,
		stdout: "pipe",
		stderr: "pipe",
	});
	strictEqual(readTree.exitCode, 0, readTree.stderr.toString());
	const apply = Bun.spawn(["git", "apply", "--cached", "--check", "-"], {
		env: gitEnvironment,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	apply.stdin.write(`${projection.lines.join("\n")}\n`);
	apply.stdin.end();
	strictEqual(await apply.exited, 0, await new Response(apply.stderr).text());
} finally {
	if (existsSync(temporaryIndex)) unlinkSync(temporaryIndex);
}

console.log("collection lifecycle acceptance staging: PASS");
