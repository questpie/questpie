import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { runOwnedBunProcess } from "../support/owned-bun-process";

const repositoryRoot = resolve(import.meta.dir, "../..");
const releaseVersion = JSON.parse(
	await readFile(
		resolve(repositoryRoot, "packages/questpie/package.json"),
		"utf8",
	),
).version as string;

test("owns the aggregate release and production-backend budgets", async () => {
	const started = performance.now();
	const { exit, stdout, stderr, timedOut } = await runOwnedBunProcess(
		"run",
		["release", "--", "--dry-run"],
		45_000,
	);
	const elapsed = performance.now() - started;
	expect(timedOut, stderr).toBe(false);
	expect(exit, stderr).toBe(0);
	expect(elapsed).toBeLessThanOrEqual(15_000);
	expect(stdout).toContain(`questpie@${releaseVersion}`);
	expect(stdout).toContain(`questpie-opentelemetry@${releaseVersion}`);
	expect(stdout).toContain("exact-peers");
	expect(stdout).toContain("exact-two-package combined-import");

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
		[
			...Array.from(
				{ length: 12 },
				(_, index) => `BETA-${String(index + 1).padStart(2, "0")}`,
			),
			"PB-05",
		].sort(),
	);
	expect(stdout).toContain("packed-build");
}, 60_000);
