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
	peerDependencies?: Record<string, string>;
	peerDependenciesMeta?: Record<string, { optional?: boolean }>;
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

const expectedPublicPackageNames = ["questpie", "questpie-opentelemetry"];

if (publicPackages.length === 0) {
	console.log("package-contract: no publishable implementation packages yet");
	process.exit(0);
}

if (
	JSON.stringify(
		publicPackages
			.map(({ json }) => json.name)
			.sort((left, right) => (left ?? "").localeCompare(right ?? "")),
	) !== JSON.stringify([...expectedPublicPackageNames].sort())
)
	fail(
		"publishable packages must be exactly questpie and questpie-opentelemetry",
	);

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
	if (
		json.name === "questpie" &&
		(!inspection.includes("dist/internal/observability.d.ts") ||
			!inspection.includes("dist/internal/observability.js") ||
			!inspection.includes("dist/react.d.ts") ||
			!inspection.includes("dist/react.js"))
	)
		fail(`${label}: tarball omits a required public subpath`);
	if (
		json.name === "questpie" &&
		JSON.stringify(Object.keys(json.exports).sort()) !==
			JSON.stringify([".", "./internal/observability", "./react"])
	)
		fail(`${label}: exports an unexpected public surface`);
	if (
		json.name === "questpie" &&
		(json.peerDependencies?.react !== "^19.2.0" ||
			json.peerDependenciesMeta?.react?.optional !== true)
	)
		fail(`${label}: React must be the optional ^19.2.0 peer for ./react`);
	if (
		json.name === "questpie" &&
		Object.keys(json.dependencies ?? {}).some(
			(name) =>
				name === "@questpie/opentelemetry" ||
				name === "questpie-opentelemetry" ||
				name.startsWith("@opentelemetry/"),
		)
	)
		fail(`${label}: core must not depend on OpenTelemetry`);
	if (json.name === "questpie-opentelemetry") {
		if (
			JSON.stringify(Object.keys(json.exports).sort()) !== JSON.stringify(["."])
		)
			fail(`${label}: exports an unexpected public surface`);
		if (
			JSON.stringify(json.peerDependencies) !==
			JSON.stringify({ questpie: json.version })
		)
			fail(`${label}: questpie must be its sole exact-version peer`);
		if (
			Object.keys(json.dependencies ?? {}).some(
				(name) => !name.startsWith("@opentelemetry/"),
			)
		)
			fail(`${label}: owns a non-OpenTelemetry production dependency`);
		if (inspection.includes("dist/testing"))
			fail(`${label}: publishes the repository-only test harness`);
	}
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
				"./react": {
					types: "./dist/react.d.ts",
					import: "./dist/react.js",
				},
				"./internal/observability": {
					types: "./dist/internal/observability.d.ts",
					import: "./dist/internal/observability.js",
				},
			},
			false,
		);
		install("@questpie/runtime", "packages/runtime", {
			".": "./dist/index.js",
			"./bundle": "./dist/bundle.js",
			"./codec": "./dist/codec/index.js",
			"./bundle-core": "./dist/bundle-core.js",
			"./bundle-core-types": "./dist/bundle-core-types.d.ts",
			"./bundle-realtime": "./dist/bundle-realtime.js",
			"./observation": "./dist/observation/index.js",
			"./operation": "./dist/operation/index.js",
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
		const typeConsumer = join(temporary, "runtime-type-consumer.ts");
		writeFileSync(
			typeConsumer,
			'import type { PostgresTransactionRunner } from "@questpie/runtime/bundle-core-types";\ndeclare const runner: PostgresTransactionRunner;\nvoid runner;\n',
		);
		const typecheck = Bun.spawnSync(
			[
				"bun",
				join(nodeModules, "typescript", "bin", "tsc"),
				"--noEmit",
				"--module",
				"NodeNext",
				"--moduleResolution",
				"NodeNext",
				"--target",
				"ES2022",
				typeConsumer,
			],
			{ cwd: temporary, stdout: "pipe", stderr: "pipe" },
		);
		if (typecheck.exitCode !== 0)
			fail(
				`private Runtime declaration export is not consumable: ${typecheck.stdout.toString()}${typecheck.stderr.toString()}`.trim(),
			);
		const bridgeTypeConsumer = join(temporary, "bridge-type-consumer.ts");
		writeFileSync(
			bridgeTypeConsumer,
			`import {
	bindOfficialQuestpieObservability,
	createOfficialQuestpieObservability,
	type QuestpieObservationRuntimeMetadataV1,
} from "questpie/internal/observability";
// @ts-expect-error the official bridge is deliberately absent from the public root
import { bindOfficialQuestpieObservability as leakedBridge } from "questpie";
declare const metadata: QuestpieObservationRuntimeMetadataV1;
const handle = createOfficialQuestpieObservability(() => ({}));
bindOfficialQuestpieObservability(handle, metadata);
void leakedBridge;
`,
		);
		const bridgeTypecheck = Bun.spawnSync(
			[
				"bun",
				join(nodeModules, "typescript", "bin", "tsc"),
				"--noEmit",
				"--module",
				"Preserve",
				"--moduleResolution",
				"Bundler",
				"--target",
				"ES2022",
				bridgeTypeConsumer,
			],
			{ cwd: temporary, stdout: "pipe", stderr: "pipe" },
		);
		if (bridgeTypecheck.exitCode !== 0)
			fail(
				`official bridge declarations are not isolated: ${bridgeTypecheck.stdout.toString()}${bridgeTypecheck.stderr.toString()}`.trim(),
			);

		const questpieRoot = await import(
			`${pathToFileURL(join(nodeModules, "questpie/dist/index.js")).href}?relocated=${crypto.randomUUID()}`
		);
		for (const forbidden of [
			"bindOfficialQuestpieObservability",
			"createOfficialQuestpieObservability",
			"QUESTPIE_OBSERVABILITY_PACKAGE_VERSION",
		])
			if (forbidden in questpieRoot)
				fail(`questpie: root unexpectedly exports ${forbidden}`);
		const bridge = await import(
			`${pathToFileURL(join(nodeModules, "questpie/dist/internal/observability.js")).href}?relocated=${crypto.randomUUID()}`
		);
		if (
			typeof bridge.createOfficialQuestpieObservability !== "function" ||
			typeof bridge.bindOfficialQuestpieObservability !== "function"
		)
			fail("questpie: relocated official observability bridge is incomplete");

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
