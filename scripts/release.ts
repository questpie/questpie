import { createHash } from "node:crypto";
import {
	cpSync,
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
	console.error(`release: ${message}`);
	process.exit(1);
}

function value(flag: string): string | undefined {
	const index = Bun.argv.indexOf(flag);
	return index === -1 ? undefined : Bun.argv[index + 1];
}

function run(command: string[], cwd?: string): string {
	const result = Bun.spawnSync(command, {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		fail(`${command.join(" ")} failed: ${result.stderr.toString().trim()}`);
	return result.stdout.toString();
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
		.map(([exportName, value]) => {
			const target = declarationTarget(value);
			if (!target)
				fail(
					`${json.name ?? packageRoot}: ${exportName} has no declaration target`,
				);
			return {
				export: exportName,
				target,
				sha256: sha256(resolve(packageRoot, target)),
			};
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

function extractPackage(
	consumer: string,
	name: ReleasePackageName,
	tarball: string,
): void {
	const installed = join(consumer, "node_modules", ...name.split("/"));
	mkdirSync(installed, { recursive: true });
	run(["tar", "-xzf", tarball, "--strip-components=1", "-C", installed]);
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
): void {
	for (const dependency of Object.keys(dependencies ?? {})) {
		const source = resolve(
			packageRoot,
			"node_modules",
			...dependency.split("/"),
		);
		if (!existsSync(source))
			fail(
				`questpie-opentelemetry: dependency is unavailable for isolated import: ${dependency}`,
			);
		const target = join(consumer, "node_modules", ...dependency.split("/"));
		mkdirSync(dirname(target), { recursive: true });
		symlinkSync(source, target, "dir");
	}
}

function installReactTestPeer(consumer: string): void {
	const reactRoot = join(consumer, "node_modules", "react");
	mkdirSync(reactRoot, { recursive: true });
	writeFileSync(
		join(reactRoot, "package.json"),
		JSON.stringify({
			name: "react",
			version: "19.2.8",
			type: "module",
			exports: "./index.js",
		}),
	);
	writeFileSync(
		join(reactRoot, "index.js"),
		"export const useSyncExternalStore = (_subscribe, getSnapshot) => getSnapshot();\n",
	);
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
			run(
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
			run(
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
			extractPackage(consumer, profile.name, artifact.firstTarball);
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
					fail("questpie/react: optional peer or mismatch boundary drifted");
				run(["bun", "-e", 'await import("questpie")'], consumer);
				const missingReact = Bun.spawnSync(
					["bun", "-e", 'await import("questpie/react")'],
					{ cwd: consumer, stdout: "pipe", stderr: "pipe" },
				);
				if (missingReact.exitCode === 0)
					fail("questpie/react: import succeeded without React");
				installReactTestPeer(consumer);
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
				extractPackage(consumer, "questpie", core.firstTarball);
				const installed = JSON.parse(
					readFileSync(
						join(consumer, "node_modules/questpie-opentelemetry/package.json"),
						"utf8",
					),
				) as PackageJson;
				if (installed.peerDependencies?.questpie !== releaseVersion)
					fail("questpie-opentelemetry: exact peer boundary drifted");
				linkPackageDependencies(consumer, packageRoot, installed.dependencies);
			}

			run(
				[
					"bun",
					"-e",
					profile.kind === "opentelemetry"
						? 'const value = await import("questpie-opentelemetry"); if (typeof value.createOpenTelemetry !== "function") process.exit(1)'
						: 'await import("questpie"); const value = await import("questpie/react"); if (typeof value.useQueryResource !== "function") process.exit(1)',
				],
				consumer,
			);
			verifyNegativeImports(
				consumer,
				[
					`${profile.name}/runtime`,
					"@questpie/runtime",
					"@questpie/react",
					"@questpie/opentelemetry",
					"questpie/opentelemetry",
				],
				profile.name,
			);

			if (profile.kind === "core") {
				const packedApplication = join(temporary, "packed-application");
				cpSync(resolve("fixtures/archive"), packedApplication, {
					recursive: true,
				});
				rmSync(join(packedApplication, "node_modules"), {
					force: true,
					recursive: true,
				});
				rmSync(join(packedApplication, ".questpie/generated"), {
					force: true,
					recursive: true,
				});
				rmSync(join(packedApplication, "bun.lock"), { force: true });
				const applicationPackagePath = join(packedApplication, "package.json");
				const applicationPackage = JSON.parse(
					readFileSync(applicationPackagePath, "utf8"),
				) as Record<string, unknown>;
				applicationPackage.dependencies = {
					questpie: `file:${artifact.firstTarball}`,
				};
				writeFileSync(
					applicationPackagePath,
					JSON.stringify(applicationPackage),
				);
				const tsconfigPath = join(packedApplication, "tsconfig.json");
				const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
					compilerOptions: { paths?: Record<string, string[]> };
				};
				delete tsconfig.compilerOptions.paths?.questpie;
				writeFileSync(tsconfigPath, JSON.stringify(tsconfig));
				run(["bun", "install", "--ignore-scripts"], packedApplication);
				run(
					[join(packedApplication, "node_modules/.bin/questpie"), "build"],
					packedApplication,
				);
				if (
					!existsSync(
						join(
							packedApplication,
							".questpie/generated/internal/application.js",
						),
					)
				)
					fail(`${profile.name}: packed CLI emitted no Runtime application`);
			}

			const markers =
				profile.kind === "core"
					? "retry-stable isolated-import negative-imports optional-react peer-mismatch packed-build"
					: "retry-stable isolated-import negative-imports exact-peers peer-mismatch";
			console.log(
				`release dry-run: ${profile.name}@${json.version} ${basename(artifact.firstTarball)} sha256=${artifact.actual} ${markers}`,
			);
		}

		const combinedConsumer = join(temporary, "consumer-combined");
		mkdirSync(combinedConsumer, { recursive: true });
		writeFileSync(
			join(combinedConsumer, "package.json"),
			JSON.stringify({
				name: "questpie-combined-release-consumer",
				private: true,
				type: "module",
			}),
		);
		for (const artifact of packedArtifacts)
			extractPackage(
				combinedConsumer,
				artifact.package.profile.name,
				artifact.firstTarball,
			);
		installReactTestPeer(combinedConsumer);
		const telemetryArtifact = packedArtifacts.find(
			(candidate) => candidate.package.profile.kind === "opentelemetry",
		);
		if (!telemetryArtifact)
			fail("questpie-opentelemetry: combined release artifact is missing");
		linkPackageDependencies(
			combinedConsumer,
			telemetryArtifact.package.root,
			telemetryArtifact.package.json.dependencies,
		);
		run(
			[
				"bun",
				"-e",
				'await import("questpie"); await import("questpie/react"); await import("questpie-opentelemetry")',
			],
			combinedConsumer,
		);
		verifyNegativeImports(
			combinedConsumer,
			["@questpie/react", "@questpie/opentelemetry", "questpie/opentelemetry"],
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
		["npm", "publish", "--provenance", "--access", "public"],
		{
			cwd: root,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0) fail(`npm publish failed for ${root}`);
}
