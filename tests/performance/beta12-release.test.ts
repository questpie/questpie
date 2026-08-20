import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("owns the aggregate beta.1 release gate budget", async () => {
	const started = performance.now();
	const release = Bun.spawnSync(["bun", "run", "release", "--", "--dry-run"], {
		cwd: repositoryRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	const elapsed = performance.now() - started;
	expect(release.exitCode, release.stderr.toString()).toBe(0);
	expect(elapsed).toBeLessThanOrEqual(15_000);

	const root = resolve(repositoryRoot, "quality/performance");
	const manifests = await Promise.all(
		(await readdir(root))
			.filter((name) => name.endsWith(".json"))
			.map(async (name) =>
				JSON.parse(await readFile(resolve(root, name), "utf8")),
			),
	);
	const owners = new Set(
		manifests.map(
			(manifest: Readonly<{ budgetOwner: string }>) => manifest.budgetOwner,
		),
	);
	expect([...owners].sort()).toEqual(
		Array.from(
			{ length: 12 },
			(_, index) => `BETA-${String(index + 1).padStart(2, "0")}`,
		),
	);
	expect(release.stdout.toString()).toContain("packed-build");
});
