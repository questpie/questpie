import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type PackageJson = Readonly<{
	name?: string;
	version?: string;
	private?: boolean;
	peerDependencies?: Readonly<Record<string, string>>;
}>;

const releaseProfiles = [
	{ name: "questpie", kind: "core" },
	{ name: "@questpie/react", kind: "react" },
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
		declarationSha256: string;
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
			const declaration = resolve(packageRoot, "dist/index.d.ts");
			if (sha256(declaration) !== expected.declarationSha256)
				fail(`${profile.name}: declaration checksum mismatch`);
			packedArtifacts.push({
				package: releasePackage,
				expected,
				firstTarball,
				actual,
			});
		}

		for (const artifact of packedArtifacts) {
			const { json, profile } = artifact.package;
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

			if (profile.kind === "react") {
				const core = packedArtifacts.find(
					(candidate) => candidate.package.profile.kind === "core",
				);
				if (!core)
					fail("questpie: core package must precede React verification");
				extractPackage(consumer, "questpie", core.firstTarball);
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
				const installed = JSON.parse(
					readFileSync(
						join(consumer, "node_modules/@questpie/react/package.json"),
						"utf8",
					),
				) as PackageJson;
				const peers = installed.peerDependencies;
				if (
					!peers ||
					peers.questpie !== releaseVersion ||
					peers.react !== "^19.2.0" ||
					!Bun.semver.satisfies("19.2.8", peers.react) ||
					Bun.semver.satisfies("18.3.1", peers.react)
				)
					fail("@questpie/react: exact peer or mismatch boundary drifted");
			}

			run(
				[
					"bun",
					"-e",
					profile.kind === "react"
						? 'const value = await import("@questpie/react"); if (typeof value.useQueryResource !== "function") process.exit(1)'
						: 'await import("questpie")',
				],
				consumer,
			);
			verifyNegativeImports(
				consumer,
				[`${profile.name}/runtime`, "@questpie/runtime"],
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
					? "retry-stable isolated-import negative-imports packed-build"
					: "retry-stable isolated-import negative-imports exact-peers peer-mismatch";
			console.log(
				`release dry-run: ${profile.name}@${json.version} ${basename(artifact.firstTarball)} sha256=${artifact.actual} ${markers}`,
			);
		}
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
