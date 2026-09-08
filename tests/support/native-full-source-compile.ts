import { cp, mkdir, symlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { compileApplication } from "@questpie/compiler";

const [repository, temporary] = process.argv.slice(2);
if (!repository || !temporary)
	throw new TypeError("Expected repository and owned temporary directory");

// Keep both compiles in one ordinary Bun process. Bun 1.3.14's test scanner
// can poison directory listings and silently select an ancestor dependency.
// See COMPILER-TEST-HOST.md; this does not change production resolution.
const first = await compileApplication({
	applicationRoot: join(repository, "fixtures/team-support-desk"),
	outputDirectory: join(temporary, "generated"),
});
const relocatedRoot = join(temporary, "relocated");
await cp(join(repository, "fixtures/team-support-desk"), relocatedRoot, {
	recursive: true,
	filter: (source) => !["node_modules", ".questpie"].includes(basename(source)),
});
await symlink(
	join(repository, "fixtures/team-support-desk/node_modules"),
	join(relocatedRoot, "node_modules"),
	"dir",
);
const relocatedOutput = join(relocatedRoot, ".questpie/generated");
await mkdir(relocatedOutput, { recursive: true });
await writeFile(
	join(relocatedOutput, "client.ts"),
	'throw new Error("stale generated client was loaded");\n',
);
for (const path of ["query-projection.json", "query-watchability.json"])
	await writeFile(join(relocatedOutput, path), '{"stale":true}\n');
const relocated = await compileApplication({
	applicationRoot: relocatedRoot,
	outputDirectory: relocatedOutput,
});
await writeFile(
	join(temporary, "compilations.json"),
	JSON.stringify({ first, relocated }),
);
console.log(
	JSON.stringify({ scenario: "native-full-source-compile", compilations: 2 }),
);
