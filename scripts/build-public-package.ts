import {
	cpSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";

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
rmSync(resolve(internal, "compiler"), { force: true, recursive: true });
rmSync(resolve(internal, "runtime"), { force: true, recursive: true });
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

const embeddedRuntimeImports = new Map([
	["@questpie/runtime/codec", resolve(internal, "runtime/codec/index.js")],
	[
		"@questpie/runtime/durable-schedule-contract",
		resolve(internal, "runtime/durable/schedule/contract.js"),
	],
	[
		"@questpie/runtime/operation",
		resolve(internal, "runtime/operation/index.js"),
	],
	[
		"@questpie/runtime/observation",
		resolve(internal, "runtime/observation/index.js"),
	],
	[
		"@questpie/runtime/bundle-core-types",
		resolve(internal, "runtime/bundle-core-types.js"),
	],
]);

function rewriteEmbeddedRuntimeImports(directory: string): void {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = resolve(directory, entry.name);
		if (entry.isDirectory()) {
			rewriteEmbeddedRuntimeImports(path);
			continue;
		}
		if (!entry.name.endsWith(".js") && !entry.name.endsWith(".d.ts")) continue;
		const original = readFileSync(path, "utf8");
		let rewritten = original;
		for (const [specifier, target] of embeddedRuntimeImports) {
			const pathFromCompiler = relative(dirname(path), target).replaceAll(
				"\\",
				"/",
			);
			const importPath = pathFromCompiler.startsWith(".")
				? pathFromCompiler
				: `./${pathFromCompiler}`;
			rewritten = rewritten
				.replaceAll(`"${specifier}"`, `"${importPath}"`)
				.replaceAll(`'${specifier}'`, `'${importPath}'`);
		}
		if (
			/(?:\bfrom\s+|\bimport\s*(?:\(\s*)?)(["'])@questpie\/runtime(?:\/[^"']*)?\1/u.test(
				rewritten,
			)
		)
			throw new Error(
				`embedded compiler contains an unmapped private Runtime import: ${path}`,
			);
		if (rewritten !== original) writeFileSync(path, rewritten);
	}
}

rewriteEmbeddedRuntimeImports(resolve(internal, "compiler"));

// The optional adapter bundles its fingerprint implementation, but never its
// host's native cache or React. Declaration files retain their normal layout.
const queryAdapterDirectory = resolve(
	repositoryRoot,
	"packages/questpie/dist/react-query",
);
const queryAdapter = await Bun.build({
	entrypoints: [
		resolve(repositoryRoot, "packages/questpie/src/react-query/index.ts"),
	],
	target: "browser",
	format: "esm",
	external: [
		"react",
		"react-dom",
		"@tanstack/react-query",
		"@tanstack/query-core",
	],
	outdir: queryAdapterDirectory,
	naming: "index.js",
});
if (!queryAdapter.success)
	throw new Error(
		`Query Adapter build failed: ${queryAdapter.logs.map((log) => log.message).join("; ")}`,
	);
for (const entry of readdirSync(queryAdapterDirectory)) {
	if (entry.endsWith(".js") && entry !== "index.js")
		rmSync(resolve(queryAdapterDirectory, entry));
}
cpSync(
	resolve(
		repositoryRoot,
		"packages/questpie/node_modules/@noble/hashes/LICENSE",
	),
	resolve(queryAdapterDirectory, "THIRD-PARTY-LICENSE.txt"),
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
