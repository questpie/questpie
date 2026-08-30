import { doesNotMatch, match, strictEqual } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = "docs/v4/prototypes/inverse-tomany-projection";
const manifest = JSON.parse(
	readFileSync(`${root}/acceptance-manifest.json`, "utf8"),
) as Readonly<{
	diffBase: string;
	authorityDocuments: ReadonlyArray<Readonly<{ path: string; sha256: string }>>;
}>;

for (const document of manifest.authorityDocuments) {
	strictEqual(
		createHash("sha256").update(readFileSync(document.path)).digest("hex"),
		document.sha256,
		`stale authority hash: ${document.path}`,
	);
}

const adr = readFileSync(
	"docs/adr/0032-freeze-bounded-inverse-tomany-query-projection.md",
	"utf8",
);
match(adr, /^- Status: Proposed$/m);
doesNotMatch(adr, /^- Status: Accepted$/m);

const index = readFileSync("docs/adr/README.md", "utf8");
doesNotMatch(index, /^32\. /m);
doesNotMatch(index, /ADR-0032/);

for (const path of [
	"SPEC.md",
	"CONTEXT.md",
	"HANDOFF.md",
	"apps/docs/content/docs/v4/data-and-queries.mdx",
]) {
	doesNotMatch(
		readFileSync(path, "utf8"),
		/ADR-0032|Bounded Inverse List|bounded inverse `?toMany`? Query projection/i,
		`${path} projects ADR-0032 before PASS`,
	);
}

const projection = JSON.parse(
	readFileSync(`${root}/authority-projection.json`, "utf8"),
) as Readonly<{ base: string; lines: readonly string[] }>;
strictEqual(projection.base, "6e5eb5dc82d3234b741536f81781af1101d592b9");

const temporaryIndex = join(
	tmpdir(),
	`questpie-inverse-projection-${randomUUID()}.index`,
);
const gitEnvironment = { ...Bun.env, GIT_INDEX_FILE: temporaryIndex };
try {
	const readTree = Bun.spawnSync(["git", "read-tree", "HEAD"], {
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

const diffCheck = Bun.spawnSync(
	["git", "diff", "--check", `${manifest.diffBase}..HEAD`],
	{ stdout: "pipe", stderr: "pipe" },
);
strictEqual(diffCheck.exitCode, 0, diffCheck.stderr.toString());

console.log("inverse toMany projection acceptance staging: PASS");
