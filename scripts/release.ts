import { createHash } from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { verifyPackedNativeQuery } from "./release-native-query";

type PackageJson = Readonly<{
	name?: string;
	version?: string;
	private?: boolean;
	exports?: Readonly<Record<string, unknown>>;
	peerDependencies?: Readonly<Record<string, string>>;
	peerDependenciesMeta?: Readonly<
		Record<string, Readonly<{ optional?: boolean }>>
	>;
	dependencies?: Readonly<Record<string, string>>;
	devDependencies?: Readonly<Record<string, string>>;
}>;

const releaseProfiles = [
	{ name: "questpie", kind: "core" },
	{ name: "questpie-opentelemetry", kind: "opentelemetry" },
] as const;
type ReleasePackageName = (typeof releaseProfiles)[number]["name"];

type ArtifactManifest = Readonly<{
	format: "questpie.release-artifacts";
	version: 1;
	release: string;
	packages: readonly Readonly<{
		name: string;
		version: string;
		filename: string;
		sha256: string;
		declarations: readonly Readonly<{
			export: string;
			target: string;
			sha256: string;
		}>[];
	}>[];
}>;

function fail(message: string): never {
	throw new Error(`release: ${message}`);
}

function value(flag: string): string | undefined {
	const index = Bun.argv.indexOf(flag);
	return index === -1 ? undefined : Bun.argv[index + 1];
}

async function run(command: string[], cwd?: string): Promise<string> {
	const result = Bun.spawn(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		timeout: 90_000,
	});
	const [exit, stdout, stderr] = await Promise.all([
		result.exited,
		new Response(result.stdout).text(),
		new Response(result.stderr).text(),
	]);
	if (exit !== 0) fail(`${command.join(" ")} failed: ${stderr.trim()}`);
	return stdout;
}

function sha256(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function declarationTarget(value: unknown): string | undefined {
	if (typeof value === "string")
		return value.endsWith(".d.ts") ? value : undefined;
	if (!value || typeof value !== "object") return undefined;
	const entries = value as Readonly<Record<string, unknown>>;
	if (typeof entries.types === "string") return entries.types;
	for (const candidate of Object.values(entries)) {
		const target = declarationTarget(candidate);
		if (target) return target;
	}
	return undefined;
}

function declarationInventory(packageRoot: string, json: PackageJson) {
	return Object.entries(json.exports ?? {})
		.flatMap(([exportName, value]) => {
			// A bare string export that is not a declaration file is the
			// self-referencing "./package.json" convention: it has no compiled
			// type surface to bind, so it is intentionally outside the manifest.
			if (typeof value === "string" && !value.endsWith(".d.ts")) return [];
			const target = declarationTarget(value);
			if (!target)
				fail(
					`${json.name ?? packageRoot}: ${exportName} has no declaration target`,
				);
			return [
				{
					export: exportName,
					target,
					sha256: sha256(resolve(packageRoot, target)),
				},
			];
		})
		.sort((left, right) => left.export.localeCompare(right.export));
}

const dryRun = Bun.argv.includes("--dry-run");
const manifestPath = resolve(
	value("--artifact-manifest") ?? "quality/release/package-artifacts.json",
);
if (!dryRun && value("--artifact-manifest"))
	fail("--artifact-manifest is available only with --dry-run");

if (
	!dryRun &&
	(process.env.GITHUB_ACTIONS !== "true" ||
		process.env.GITHUB_REF_TYPE !== "tag")
) {
	fail("publishing requires a tagged GitHub Actions release run");
}

const packagesRoot = resolve("packages");
if (!existsSync(packagesRoot)) fail("no publishable packages directory exists");
const discoveredPackages = readdirSync(packagesRoot)
	.map((name) => resolve(packagesRoot, name))
	.filter((path) => existsSync(resolve(path, "package.json")))
	.map((root) => ({
		root,
		json: JSON.parse(
			readFileSync(resolve(root, "package.json"), "utf8"),
		) as PackageJson,
	}))
	.filter(({ json }) => !json.private);
if (discoveredPackages.length === 0)
	fail("no non-private package is eligible for release");

const packageNames = new Set(discoveredPackages.map(({ json }) => json.name));
const expectedPackageNames = releaseProfiles.map(({ name }) => name);
if (
	packageNames.size !== expectedPackageNames.length ||
	expectedPackageNames.some((name) => !packageNames.has(name))
)
	fail("public packages do not match the explicit release profiles");

const packages = releaseProfiles.map((profile) => {
	const discovered = discoveredPackages.find(
		({ json }) => json.name === profile.name,
	);
	if (!discovered) fail(`${profile.name}: explicit release package is missing`);
	if (!discovered.json.version)
		fail(`${profile.name}: package version is required`);
	return { ...discovered, profile };
});
const releaseVersions = new Set(packages.map(({ json }) => json.version));
if (releaseVersions.size !== 1)
	fail("public package versions must advance as one release");
const releaseVersion = packages[0]!.json.version as string;

async function extractPackage(
	consumer: string,
	name: ReleasePackageName,
	tarball: string,
): Promise<void> {
	const installed = join(consumer, "node_modules", ...name.split("/"));
	mkdirSync(installed, { recursive: true });
	await run(["tar", "-xzf", tarball, "--strip-components=1", "-C", installed]);
}

function verifyNegativeImports(
	consumer: string,
	imports: readonly string[],
	owner: ReleasePackageName,
): void {
	for (const forbidden of imports) {
		const rejected = Bun.spawnSync(
			["bun", "-e", `await import(${JSON.stringify(forbidden)})`],
			{ cwd: consumer, stdout: "pipe", stderr: "pipe" },
		);
		if (rejected.exitCode === 0)
			fail(`${owner}: negative import unexpectedly resolved ${forbidden}`);
	}
}

function linkPackageDependencies(
	consumer: string,
	packageRoot: string,
	dependencies: Readonly<Record<string, string>> | undefined,
	owner: string,
): void {
	for (const dependency of Object.keys(dependencies ?? {})) {
		const source = resolve(
			packageRoot,
			"node_modules",
			...dependency.split("/"),
		);
		if (!existsSync(source))
			fail(
				`${owner}: dependency is unavailable for isolated import: ${dependency}`,
			);
		const target = join(consumer, "node_modules", ...dependency.split("/"));
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(source, target, "dir");
	}
}

if (dryRun) {
	if (!existsSync(manifestPath))
		fail(`artifact manifest missing: ${manifestPath}`);
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as ArtifactManifest;
	if (
		manifest.format !== "questpie.release-artifacts" ||
		manifest.version !== 1 ||
		manifest.release !== releaseVersion
	) {
		fail(`invalid ${releaseVersion} artifact manifest`);
	}
	if (
		manifest.packages.length !== expectedPackageNames.length ||
		manifest.packages.some(
			(candidate, index) => candidate.name !== expectedPackageNames[index],
		)
	)
		fail("artifact manifest does not contain the exact public package set");

	const temporary = mkdtempSync(join(tmpdir(), "questpie-release-dry-run-"));
	try {
		const packedArtifacts: Array<{
			package: (typeof packages)[number];
			expected: ArtifactManifest["packages"][number];
			firstTarball: string;
			actual: string;
		}> = [];
		for (const [index, releasePackage] of packages.entries()) {
			const { json, profile, root: packageRoot } = releasePackage;
			const expected = manifest.packages[index]!;
			if (expected.version !== json.version)
				fail(`${profile.name}: package is version-mismatched in manifest`);

			const first = join(temporary, profile.kind, "first");
			const retry = join(temporary, profile.kind, "retry");
			mkdirSync(first, { recursive: true });
			mkdirSync(retry, { recursive: true });
			await run(
				[
					"bun",
					"pm",
					"pack",
					"--destination",
					first,
					"--ignore-scripts",
					"--quiet",
				],
				packageRoot,
			);
			await run(
				[
					"bun",
					"pm",
					"pack",
					"--destination",
					retry,
					"--ignore-scripts",
					"--quiet",
				],
				packageRoot,
			);
			const firstTarball = resolve(first, expected.filename);
			const retryTarball = resolve(retry, expected.filename);
			if (!existsSync(firstTarball) || !existsSync(retryTarball))
				fail(
					`${profile.name}: packed filename differs from ${expected.filename}`,
				);
			const actual = sha256(firstTarball);
			if (actual !== sha256(retryTarball))
				fail(`${profile.name}: release retry produced different bytes`);
			if (actual !== expected.sha256)
				fail(
					`${profile.name}: artifact checksum mismatch (expected ${expected.sha256}, received ${actual})`,
				);
			if (
				JSON.stringify(declarationInventory(packageRoot, json)) !==
				JSON.stringify(expected.declarations)
			)
				fail(`${profile.name}: declaration inventory mismatch`);
			packedArtifacts.push({
				package: releasePackage,
				expected,
				firstTarball,
				actual,
			});
		}

		for (const artifact of packedArtifacts) {
			const { json, profile, root: packageRoot } = artifact.package;
			const consumer = join(temporary, `consumer-${profile.kind}`);
			await extractPackage(consumer, profile.name, artifact.firstTarball);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: `questpie-${profile.kind}-release-consumer`,
					private: true,
					type: "module",
				}),
			);

			if (profile.kind === "core") {
				const installed = JSON.parse(
					readFileSync(
						join(consumer, "node_modules/questpie/package.json"),
						"utf8",
					),
				) as PackageJson;
				const peers = installed.peerDependencies;
				if (
					!peers ||
					peers.react !== "^19.2.0" ||
					installed.peerDependenciesMeta?.react?.optional !== true ||
					!Bun.semver.satisfies("19.2.8", peers.react) ||
					Bun.semver.satisfies("18.3.1", peers.react)
				)
					fail(
						"questpie/react-query: optional peer or mismatch boundary drifted",
					);
				// The packed tarball ships questpie's own production dependencies
				// (e.g. `pg` for questpie/testing) as ordinary package.json
				// dependencies, not bundled output; link them the same way the
				// OpenTelemetry package's dependencies are linked below so the
				// isolated single-package import check reflects a real install.
				linkPackageDependencies(
					consumer,
					packageRoot,
					installed.dependencies,
					"questpie",
				);
				await run(["bun", "-e", 'await import("questpie")'], consumer);
				await run(
					[
						"bun",
						"-e",
						'const value = await import("questpie/testing"); if (typeof value.createIsolatedApplicationDatabase !== "function" || typeof value.createTestDatabase !== "function" || typeof value.runQuestpieCli !== "function" || typeof value.eventually !== "function") process.exit(1)',
					],
					consumer,
				);
				await verifyPackedNativeQuery(
					artifact.firstTarball,
					join(temporary, "consumer-native"),
					"browser",
				);
			}
			if (profile.kind === "opentelemetry") {
				const missingCore = Bun.spawnSync(
					["bun", "-e", 'await import("questpie-opentelemetry")'],
					{ cwd: consumer, stdout: "pipe", stderr: "pipe" },
				);
				if (missingCore.exitCode === 0)
					fail("questpie-opentelemetry: import succeeded without questpie");
				const core = packedArtifacts.find(
					(candidate) => candidate.package.profile.kind === "core",
				);
				if (!core)
					fail(
						"questpie: core package must precede OpenTelemetry verification",
					);
				await extractPackage(consumer, "questpie", core.firstTarball);
				const installed = JSON.parse(
					readFileSync(
						join(consumer, "node_modules/questpie-opentelemetry/package.json"),
						"utf8",
					),
				) as PackageJson;
				if (installed.peerDependencies?.questpie !== releaseVersion)
					fail("questpie-opentelemetry: exact peer boundary drifted");
				linkPackageDependencies(
					consumer,
					packageRoot,
					installed.dependencies,
					"questpie-opentelemetry",
				);
			}

			await run(
				[
					"bun",
					"-e",
					profile.kind === "opentelemetry"
						? 'const value = await import("questpie-opentelemetry"); if (typeof value.createOpenTelemetry !== "function") process.exit(1)'
						: 'await import("questpie"); const value = await import("questpie/react-query"); const testing = await import("questpie/testing"); if (typeof value.createQueryAdapter !== "function" || typeof testing.createIsolatedApplicationDatabase !== "function") process.exit(1)',
				],
				consumer,
			);
			verifyNegativeImports(
				consumer,
				[
					`${profile.name}/runtime`,
					"@questpie/runtime",
					"@questpie/react",
					"questpie/react",
					"@questpie/opentelemetry",
					"questpie/opentelemetry",
				],
				profile.name,
			);

			const markers =
				profile.kind === "core"
					? "retry-stable isolated-import negative-imports native-react-query peer-boundary packed-build"
					: "retry-stable isolated-import negative-imports exact-peers peer-mismatch";
			console.log(
				`release dry-run: ${profile.name}@${json.version} ${basename(artifact.firstTarball)} sha256=${artifact.actual} ${markers}`,
			);
		}

		const combinedConsumer = join(temporary, "consumer-combined");
		mkdirSync(combinedConsumer, { recursive: true });
		const workspace = JSON.parse(
			readFileSync(resolve("package.json"), "utf8"),
		) as PackageJson;
		const nativePeers = Object.fromEntries(
			["react", "react-dom", "@tanstack/react-query"].map((name) => {
				const version = workspace.devDependencies?.[name];
				if (!version)
					fail(`combined native consumer has no tested ${name} pin`);
				return [name, version];
			}),
		);
		writeFileSync(
			join(combinedConsumer, "package.json"),
			JSON.stringify({
				name: "questpie-combined-release-consumer",
				private: true,
				type: "module",
				dependencies: {
					...nativePeers,
					...Object.fromEntries(
						packedArtifacts.map((artifact) => [
							artifact.package.profile.name,
							`file:${artifact.firstTarball}`,
						]),
					),
				},
			}),
		);
		await run(
			[
				"bun",
				"install",
				"--ignore-scripts",
				"--cache-dir",
				join(combinedConsumer, ".bun-cache"),
			],
			combinedConsumer,
		);
		await run(
			[
				"bun",
				"-e",
				'await import("questpie"); const { createQueryAdapter } = await import("questpie/react-query"); const { createIsolatedApplicationDatabase } = await import("questpie/testing"); const { QueryClient } = await import("@tanstack/react-query"); const React = await import("react"); const { renderToString } = await import("react-dom/server"); await import("questpie-opentelemetry"); if (typeof createQueryAdapter !== "function" || typeof createIsolatedApplicationDatabase !== "function" || renderToString(React.createElement("p", null, "native")) !== "<p>native</p>") process.exit(1); new QueryClient().clear();',
			],
			combinedConsumer,
		);
		verifyNegativeImports(
			combinedConsumer,
			[
				"@questpie/react",
				"questpie/react",
				"@questpie/opentelemetry",
				"questpie/opentelemetry",
			],
			"questpie",
		);
		console.log("release dry-run: exact-two-package combined-import");
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
	process.exit(0);
}

for (const { root } of packages) {
	const result = Bun.spawnSync(
		["npm", "publish", "--provenance", "--access", "public", "--tag", "beta"],
		{
			cwd: root,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0) fail(`npm publish failed for ${root}`);
}
