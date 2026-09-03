import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const releaseVersion = JSON.parse(
	await readFile(
		resolve(repositoryRoot, "packages/questpie/package.json"),
		"utf8",
	),
).version as string;

function run(
	command: string[],
	env?: Readonly<Record<string, string | undefined>>,
) {
	return Bun.spawnSync(command, {
		cwd: repositoryRoot,
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
}

test("dry-run packs every exact public package and rejects manifest drift", async () => {
	const first = run(["bun", "run", "release", "--", "--dry-run"]);
	expect(first.exitCode, first.stderr.toString()).toBe(0);
	expect(first.stdout.toString()).toContain(`questpie@${releaseVersion}`);
	expect(first.stdout.toString()).toContain(
		`@questpie/react@${releaseVersion}`,
	);
	expect(first.stdout.toString()).toContain(
		`@questpie/opentelemetry@${releaseVersion}`,
	);
	expect(first.stdout.toString()).toContain("retry-stable");
	expect(first.stdout.toString()).toContain("packed-build");
	expect(first.stdout.toString()).toContain("exact-peers");
	expect(first.stdout.toString()).toContain(
		"exact-three-package combined-import",
	);

	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta12-manifest-"));
	try {
		const manifest = JSON.parse(
			await readFile(
				resolve(repositoryRoot, "quality/release/package-artifacts.json"),
				"utf8",
			),
		);
		const questpie = manifest.packages.find(
			(candidate: { name: string }) => candidate.name === "questpie",
		);
		if (!questpie) throw new Error("questpie release artifact is missing");
		questpie.sha256 = "0".repeat(64);
		const tampered = join(temporary, "package-artifacts.json");
		await writeFile(tampered, `${JSON.stringify(manifest)}\n`);
		const rejected = run([
			"bun",
			"run",
			"release",
			"--",
			"--dry-run",
			"--artifact-manifest",
			tampered,
		]);
		expect(rejected.exitCode).not.toBe(0);
		expect(rejected.stderr.toString()).toContain("artifact checksum mismatch");

		const incompleteManifest = JSON.parse(
			await readFile(
				resolve(repositoryRoot, "quality/release/package-artifacts.json"),
				"utf8",
			),
		);
		incompleteManifest.packages = incompleteManifest.packages.filter(
			(candidate: { name: string }) => candidate.name !== "@questpie/react",
		);
		const incomplete = join(temporary, "incomplete-package-artifacts.json");
		await writeFile(incomplete, `${JSON.stringify(incompleteManifest)}\n`);
		const missingPackage = run([
			"bun",
			"run",
			"release",
			"--",
			"--dry-run",
			"--artifact-manifest",
			incomplete,
		]);
		expect(missingPackage.exitCode).not.toBe(0);
		expect(missingPackage.stderr.toString()).toContain(
			"exact public package set",
		);

		const missingTelemetryManifest = JSON.parse(
			await readFile(
				resolve(repositoryRoot, "quality/release/package-artifacts.json"),
				"utf8",
			),
		);
		missingTelemetryManifest.packages =
			missingTelemetryManifest.packages.filter(
				(candidate: { name: string }) =>
					candidate.name !== "@questpie/opentelemetry",
			);
		const missingTelemetryPath = join(
			temporary,
			"missing-telemetry-package-artifacts.json",
		);
		await writeFile(
			missingTelemetryPath,
			`${JSON.stringify(missingTelemetryManifest)}\n`,
		);
		const missingTelemetry = run([
			"bun",
			"run",
			"release",
			"--",
			"--dry-run",
			"--artifact-manifest",
			missingTelemetryPath,
		]);
		expect(missingTelemetry.exitCode).not.toBe(0);
		expect(missingTelemetry.stderr.toString()).toContain(
			"exact public package set",
		);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("a missing managed PostgreSQL credential is WITHHELD, never PASS", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta12-managed-"));
	try {
		const report = join(temporary, "managed.json");
		const result = run(
			[
				"bun",
				"run",
				"scripts/beta12-conformance.ts",
				"--target",
				"managed",
				"--report",
				report,
			],
			{
				PGDATABASE: undefined,
				PGHOST: undefined,
				PGPASSWORD: undefined,
				PGPORT: undefined,
				PGUSER: undefined,
			},
		);
		expect(result.exitCode).not.toBe(0);
		expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
			format: "questpie.beta12-conformance",
			target: "managed",
			status: "WITHHELD",
			reason: "MISSING_CREDENTIAL",
		});
		expect(result.stdout.toString()).not.toContain('"status":"PASS"');
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});

test("a local endpoint cannot be relabelled as selected managed evidence", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta12-target-"));
	try {
		const report = join(temporary, "managed.json");
		const result = run(
			[
				"bun",
				"run",
				"scripts/beta12-conformance.ts",
				"--target",
				"managed",
				"--report",
				report,
			],
			{
				PGDATABASE: "postgres",
				PGHOST: "127.0.0.1",
				["PGPASSWORD"]: "x",
				PGUSER: "postgres",
			},
		);
		expect(result.exitCode).not.toBe(0);
		expect(JSON.parse(await readFile(report, "utf8"))).toMatchObject({
			format: "questpie.beta12-conformance",
			target: "managed",
			profile: "supabase-postgresql",
			status: "FAIL",
			reason: "TARGET_MISMATCH",
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
