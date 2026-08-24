import { cpSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "..");

function run(command: string[]): void {
	const result = Bun.spawnSync(command, {
		cwd: repositoryRoot,
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	if (result.exitCode !== 0)
		throw new Error(`${command.join(" ")} exited ${result.exitCode}`);
}

const typescript = resolve(repositoryRoot, "node_modules/typescript/bin/tsc");

for (const workspace of ["questpie", "runtime", "compiler"]) {
	rmSync(resolve(repositoryRoot, `packages/${workspace}/dist`), {
		force: true,
		recursive: true,
	});
	run(["bun", typescript, "-p", `packages/${workspace}/tsconfig.json`]);
}
run(["bun", "packages/runtime/scripts/copy-source-declarations.ts"]);

const internal = resolve(repositoryRoot, "packages/questpie/dist/internal");
rmSync(internal, { force: true, recursive: true });
cpSync(
	resolve(repositoryRoot, "packages/compiler/dist"),
	resolve(internal, "compiler"),
	{
		recursive: true,
	},
);
cpSync(
	resolve(repositoryRoot, "packages/runtime/dist"),
	resolve(internal, "runtime"),
	{
		recursive: true,
	},
);

const built = await Bun.build({
	entrypoints: [resolve(repositoryRoot, "packages/questpie/cli/questpie.ts")],
	target: "bun",
	format: "esm",
	minify: { syntax: true, whitespace: true },
	outdir: resolve(repositoryRoot, "packages/questpie/dist"),
	naming: "cli.js",
});
if (!built.success)
	throw new Error(
		`public CLI build failed: ${built.logs.map((log) => log.message).join("; ")}`,
	);
