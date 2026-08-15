import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	createCommittedMigration,
	createMigrationPlan,
} from "@questpie/compiler";

test("BETA-02 migration artifacts stay inside stable-runner budgets", async () => {
	const targetSchema = JSON.parse(
		await readFile(
			resolve(
				import.meta.dir,
				"../../fixtures/collaboration/questpie/migrations/000001_create-collaboration/target-schema.json",
			),
			"utf8",
		),
	);
	const started = performance.now();
	const planned = createMigrationPlan({
		targetSchema,
		slug: "create-collaboration",
	});
	const committed = createCommittedMigration({
		plan: planned.plan,
		baseSchema: planned.baseSchema,
		targetSchema,
		currentSchema: targetSchema,
		planDigest: planned.digest,
		localMigrations: [],
	});
	const planCreateMs = performance.now() - started;
	const migrationGoldenBytes = Object.values(committed.files).reduce(
		(total, value) => total + Buffer.byteLength(value),
		0,
	);

	expect(planCreateMs).toBeLessThanOrEqual(1_000);
	expect(migrationGoldenBytes).toBe(25_528);
	console.log(
		JSON.stringify({
			scenario: "beta02-migration",
			budgetOwner: "BETA-02",
			measurements: { planCreateMs, migrationGoldenBytes },
			status: "PASS",
		}),
	);
});
