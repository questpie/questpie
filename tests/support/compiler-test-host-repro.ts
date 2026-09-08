import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Explicit diagnostic only: never assert that a future Bun must stay broken.
const body = `import { join } from "node:path";
export async function buildTwice() {
  const results = [];
  for (let build = 1; build <= 2; build++) {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, "index.ts")] });
    if (result.outputs.length !== 1) throw new Error("Expected one bundle output");
    const output = await result.outputs[0].text();
    const resolved = Bun.resolveSync("dupe", join(import.meta.dir, "top/nested"));
    results.push({
      build,
      hasApp: output.includes("app-v2"),
      hasRoot: output.includes("root-v1"),
      resolved,
      correctResolution: resolved === join(import.meta.dir, "top/node_modules/dupe/index.js"),
    });
  }
  console.log(JSON.stringify({ diagnostic: "nearer-package-version", results }));
  if (results.some((result) => !result.hasApp || result.hasRoot || !result.correctResolution))
    throw new Error("Nearer package version was replaced by ancestor version");
}
`;

const files: Readonly<Record<string, string>> = {
	"package.json": JSON.stringify({
		name: "questpie-compiler-test-host-diagnostic",
		private: true,
		type: "module",
	}),
	"index.ts":
		'import { nestedFn } from "./top/nested/nested-module";\nconsole.log(nestedFn());\n',
	"top/nested/nested-module.ts":
		'import { version } from "dupe";\nexport function nestedFn() { return version; }\n',
	"node_modules/dupe/package.json": JSON.stringify({
		name: "dupe",
		version: "1.0.0",
		type: "module",
		exports: "./index.js",
	}),
	"node_modules/dupe/index.js": 'export const version = "root-v1";\n',
	"top/node_modules/dupe/package.json": JSON.stringify({
		name: "dupe",
		version: "2.0.0",
		type: "module",
		exports: "./index.js",
	}),
	"top/node_modules/dupe/index.js": 'export const version = "app-v2";\n',
	"body.ts": body,
	"build.test.ts": `import { expect, test } from "bun:test";
import { buildTwice } from "./body";
test("Bun.build preserves the nearer package version", async () => {
  await buildTwice();
  expect(true).toBe(true);
});
`,
	"plain.ts": `import { buildTwice } from "./body";
await buildTwice();
console.log("same-body plain-process PASS");
`,
};

async function runHost(directory: string, host: "test" | "plain") {
	// A bare `bun test` is intentional: its scanner must visit the existing tree.
	const command =
		host === "test"
			? [process.execPath, "test"]
			: [process.execPath, "plain.ts"];
	const child = Bun.spawn(command, {
		cwd: directory,
		env: { ...process.env, TMPDIR: directory },
		stdout: "pipe",
		stderr: "pipe",
		timeout: 30_000,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { host, command, exitCode, stdout, stderr };
}

if (import.meta.main) {
	const temporary = await mkdtemp(
		join(tmpdir(), "questpie-compiler-test-host-repro-"),
	);
	let results: Awaited<ReturnType<typeof runHost>>[];
	try {
		// Every dependency and source file predates both child processes.
		for (const [path, contents] of Object.entries(files)) {
			const target = join(temporary, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		}
		results = [
			await runHost(temporary, "test"),
			await runHost(temporary, "plain"),
		];
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
	console.log(
		JSON.stringify(
			{
				diagnostic: "compiler-test-host",
				bunVersion: Bun.version,
				temporaryRemoved: true,
				results,
			},
			null,
			2,
		),
	);
	if (results[1]?.exitCode !== 0) process.exitCode = 1;
}
