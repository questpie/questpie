import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

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

test("dry-run packs a stable checked beta.1 artifact and rejects checksum drift", async () => {
	const first = run(["bun", "run", "release", "--", "--dry-run"]);
	expect(first.exitCode, first.stderr.toString()).toBe(0);
	expect(first.stdout.toString()).toContain("questpie@4.0.0-beta.1");
	expect(first.stdout.toString()).toContain("retry-stable");
	expect(first.stdout.toString()).toContain("packed-build");

	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta12-manifest-"));
	try {
		const manifest = JSON.parse(
			await readFile(
				resolve(repositoryRoot, "quality/release/package-artifacts.json"),
				"utf8",
			),
		);
		manifest.packages[0].sha256 = "0".repeat(64);
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
