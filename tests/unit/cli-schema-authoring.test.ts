import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import * as compiler from "@questpie/compiler";

import { authorSchema } from "../../packages/questpie/cli/schema-authoring";

const fixture = resolve(import.meta.dir, "../../fixtures/collaboration");

test("CLI authoring persists reviewed migrations and Seeds, refusing stale plans and changed immutable Seeds", async () => {
	const root = await mkdtemp(join(tmpdir(), "questpie-schema-authoring-"));
	try {
		await cp(fixture, root, { recursive: true });
		await rm(join(root, "questpie"), { recursive: true, force: true });
		const plan = await authorSchema(compiler, root, [
			"migration",
			"plan",
			"--name",
			"create-collaboration",
		]);
		expect(plan.status).toBe("planned");
		const plannedFile = join(root, String(plan.path));
		const bytes = await readFile(plannedFile, "utf8");
		expect(bytes).toBe(compiler.canonicalArtifactBytes(JSON.parse(bytes)));
		const created = await authorSchema(compiler, root, [
			"migration",
			"create",
			"--plan",
			String(plan.path),
		]);
		expect(created.identity).toBe("000001_create-collaboration");
		const migration = await compiler.loadCommittedMigration(
			join(root, "questpie/migrations", String(created.identity)),
		);
		compiler.verifyCommittedMigration(migration);
		await expect(
			authorSchema(compiler, root, [
				"migration",
				"create",
				"--plan",
				String(plan.path),
			]),
		).rejects.toThrow();
		expect(
			(
				await authorSchema(compiler, root, [
					"migration",
					"plan",
					"--name",
					"no-change",
				])
			).status,
		).toBe("noChanges");
		const seeds = await authorSchema(compiler, root, ["seed", "create"]);
		expect(seeds.status).toBe("created");
		expect(
			(await authorSchema(compiler, root, ["seed", "create"])).status,
		).toBe("unchanged");
		const seedPath = join(
			root,
			"questpie/seeds/collaboration.demo.v1/steps.json",
		);
		const saved = await readFile(seedPath, "utf8");
		await writeFile(seedPath, saved + " ");
		await expect(
			authorSchema(compiler, root, ["seed", "create"]),
		).rejects.toThrow();
		expect(await readFile(seedPath, "utf8")).toBe(saved + " ");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}, 60000);
