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
}>;

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
if (!existsSync(packagesRoot))
	fail("no publishable packages exist in this beta foundation");
const packageDirs = readdirSync(packagesRoot)
	.map((name) => resolve(packagesRoot, name))
	.filter((path) => existsSync(resolve(path, "package.json")))
	.filter((path) => {
		const json = JSON.parse(
			readFileSync(resolve(path, "package.json"), "utf8"),
		) as PackageJson;
		return !json.private;
	});
if (packageDirs.length === 0)
	fail("no non-private package is eligible for release");

if (dryRun) {
	if (!existsSync(manifestPath))
		fail(`artifact manifest missing: ${manifestPath}`);
	const manifest = JSON.parse(
		readFileSync(manifestPath, "utf8"),
	) as ArtifactManifest;
	if (
		manifest.format !== "questpie.release-artifacts" ||
		manifest.version !== 1 ||
		manifest.release !== "4.0.0-beta.1"
	) {
		fail("invalid beta.1 artifact manifest");
	}

	const temporary = mkdtempSync(join(tmpdir(), "questpie-release-dry-run-"));
	try {
		for (const packageRoot of packageDirs) {
			const json = JSON.parse(
				readFileSync(resolve(packageRoot, "package.json"), "utf8"),
			) as PackageJson;
			if (!json.name || !json.version)
				fail(`${packageRoot}: package name and version are required`);
			const expected = manifest.packages.find(
				(candidate) => candidate.name === json.name,
			);
			if (!expected || expected.version !== json.version)
				fail(
					`${json.name}: package is absent or version-mismatched in manifest`,
				);

			const first = join(temporary, "first");
			const retry = join(temporary, "retry");
			mkdirSync(first);
			mkdirSync(retry);
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
				fail(`${json.name}: packed filename differs from ${expected.filename}`);
			const actual = sha256(firstTarball);
			if (actual !== sha256(retryTarball))
				fail(`${json.name}: release retry produced different bytes`);
			if (actual !== expected.sha256)
				fail(
					`${json.name}: artifact checksum mismatch (expected ${expected.sha256}, received ${actual})`,
				);
			const declaration = resolve(packageRoot, "dist/index.d.ts");
			if (sha256(declaration) !== expected.declarationSha256)
				fail(`${json.name}: declaration checksum mismatch`);

			const consumer = join(temporary, "consumer");
			const installed = join(consumer, "node_modules", json.name);
			mkdirSync(installed, { recursive: true });
			run([
				"tar",
				"-xzf",
				firstTarball,
				"--strip-components=1",
				"-C",
				installed,
			]);
			writeFileSync(
				join(consumer, "package.json"),
				JSON.stringify({
					name: "questpie-release-consumer",
					private: true,
					type: "module",
				}),
			);
			run(
				["bun", "-e", `await import(${JSON.stringify(json.name)})`],
				consumer,
			);
			for (const forbidden of [`${json.name}/runtime`, "@questpie/runtime"]) {
				const rejected = Bun.spawnSync(
					["bun", "-e", `await import(${JSON.stringify(forbidden)})`],
					{ cwd: consumer, stdout: "pipe", stderr: "pipe" },
				);
				if (rejected.exitCode === 0)
					fail(
						`${json.name}: negative import unexpectedly resolved ${forbidden}`,
					);
			}

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
			applicationPackage.dependencies = { questpie: `file:${firstTarball}` };
			writeFileSync(applicationPackagePath, JSON.stringify(applicationPackage));
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
				fail(`${json.name}: packed CLI emitted no Runtime application`);
			console.log(
				`release dry-run: ${json.name}@${json.version} ${basename(firstTarball)} sha256=${actual} retry-stable clean-install negative-imports packed-build`,
			);
		}
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
	process.exit(0);
}

for (const path of packageDirs) {
	const result = Bun.spawnSync(
		["npm", "publish", "--provenance", "--access", "public"],
		{
			cwd: path,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	if (result.exitCode !== 0) fail(`npm publish failed for ${path}`);
}
