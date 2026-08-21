import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	embeddedProductionDependencies,
	validateEmbeddedProductionDependencies,
} from "./package-contract-dependencies";

type PackageJson = {
	name?: string;
	version?: string;
	private?: boolean;
	type?: string;
	files?: string[];
	exports?: Record<string, unknown>;
	scripts?: Record<string, string>;
	dependencies?: Record<string, string>;
};

function fail(message: string): never {
	console.error(`package-contract: ${message}`);
	process.exit(1);
}

function packageFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	return readdirSync(root)
		.map((name) => resolve(root, name, "package.json"))
		.filter(existsSync)
		.sort();
}

function targets(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!value || typeof value !== "object") return [];
	return Object.values(value).flatMap(targets);
}

const publicPackages = packageFiles(resolve("packages"))
	.map((path) => ({
		path,
		json: JSON.parse(readFileSync(path, "utf8")) as PackageJson,
	}))
	.filter(({ json }) => !json.private);

if (publicPackages.length === 0) {
	console.log("package-contract: no publishable implementation packages yet");
	process.exit(0);
}

for (const { path, json } of publicPackages) {
	const label = json.name ?? path;
	if (!json.name || !json.version)
		fail(`${label}: name and version are required`);
	if (json.type !== "module") fail(`${label}: type must be module`);
	if (!json.scripts?.build) fail(`${label}: a build script is required`);
	if (!json.files?.includes("dist")) fail(`${label}: files must include dist`);
	if (!json.exports || !("." in json.exports))
		fail(`${label}: exports must define the package root`);

	const exportedTargets = targets(json.exports);
	if (!exportedTargets.some((target) => target.endsWith(".d.ts")))
		fail(`${label}: exports must expose declarations`);
	for (const target of exportedTargets.filter((entry) =>
		entry.startsWith("./"),
	)) {
		const artifact = resolve(dirname(path), target);
		if (!existsSync(artifact) || !statSync(artifact).isFile())
			fail(`${label}: missing built export ${target}`);
	}

	const packageRoot = dirname(path);
	const packed = Bun.spawnSync(
		["bun", "pm", "pack", "--dry-run", "--ignore-scripts"],
		{ cwd: packageRoot, stdout: "pipe", stderr: "pipe" },
	);
	const inspection = `${packed.stdout.toString()}${packed.stderr.toString()}`;
	if (packed.exitCode !== 0)
		fail(`${label}: tarball inspection failed: ${inspection.trim()}`);
	if (
		!inspection.includes("dist/index.d.ts") ||
		!inspection.includes("dist/index.js")
	)
		fail(`${label}: tarball omits built declarations or ESM entry`);
	if (/packed .*\bsrc\//.test(inspection))
		fail(`${label}: tarball unexpectedly contains source files`);
}

async function verifyPrivateBuildClosure(): Promise<void> {
	const temporary = mkdtempSync(join(tmpdir(), "questpie-private-packages-"));
	try {
		const nodeModules = join(temporary, "node_modules");
		const privateSources = ["packages/runtime", "packages/compiler"] as const;
		const privateManifests = privateSources.map(
			(source) =>
				JSON.parse(
					readFileSync(resolve(source, "package.json"), "utf8"),
				) as PackageJson,
		);
		const embeddedDependencies =
			embeddedProductionDependencies(privateManifests);
		const publicManifest = JSON.parse(
			readFileSync(resolve("packages/questpie/package.json"), "utf8"),
		) as PackageJson;
		try {
			validateEmbeddedProductionDependencies(
				publicManifest.dependencies,
				embeddedDependencies,
				publicManifest.name,
			);
		} catch (error) {
			fail(error instanceof Error ? error.message : String(error));
		}
		const install = (
			name: string,
			source: string,
			exports: Readonly<Record<string, unknown>>,
			isPrivate = true,
		): void => {
			const root = join(nodeModules, ...name.split("/"));
			const sourceManifest = JSON.parse(
				readFileSync(resolve(source, "package.json"), "utf8"),
			) as PackageJson;
			mkdirSync(root, { recursive: true });
			cpSync(resolve(source, "dist"), join(root, "dist"), {
				recursive: true,
			});
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({
					name,
					version: sourceManifest.version,
					private: isPrivate,
					type: "module",
					exports,
					dependencies: sourceManifest.dependencies,
				}),
			);
			if (existsSync(join(root, "src")))
				fail(`${name}: relocated build unexpectedly contains source files`);
		};

		install(
			"questpie",
			"packages/questpie",
			{
				".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
			},
			false,
		);
		install("@questpie/runtime", "packages/runtime", {
			".": "./dist/index.js",
			"./bundle": "./dist/bundle.js",
			"./bundle-core": "./dist/bundle-core.js",
			"./bundle-realtime": "./dist/bundle-realtime.js",
		});
		install("@questpie/compiler", "packages/compiler", {
			".": "./dist/index.js",
		});
		for (const name of embeddedDependencies.keys()) {
			const installed = resolve("node_modules", ...name.split("/"));
			if (!existsSync(installed))
				fail(`embedded production dependency ${name} is not installed`);
			const staged = join(nodeModules, ...name.split("/"));
			mkdirSync(dirname(staged), { recursive: true });
			symlinkSync(installed, staged);
		}

		const applicationRoot = join(temporary, "application");
		cpSync(resolve("fixtures/collaboration"), applicationRoot, {
			recursive: true,
		});
		const compiler = await import(
			`${pathToFileURL(join(nodeModules, "@questpie/compiler/dist/index.js")).href}?relocated=${crypto.randomUUID()}`
		);
		const compilation = await compiler.compileApplication({ applicationRoot });
		if (!compilation.generatedFiles["internal/application.js"])
			fail("private package closure emitted no Runtime application bundle");
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
}

await verifyPrivateBuildClosure();

console.log(
	`package-contract: ${publicPackages.length} publishable package(s) valid`,
);
