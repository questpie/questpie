import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("BETA-02 migration artifacts", () => {
	test("plans and commits the collaboration Genesis migration exactly", async () => {
		const compilation = await compileApplication({
			applicationRoot: fixtureRoot,
		});
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-collaboration",
		});

		expect(planned.plan).toMatchObject({
			format: "questpie.migration-plan",
			version: 1,
			application: "collaboration",
			baseMigration: null,
			classification: "guarded",
		});
		expect(planned.plan.steps.map((step) => step.kind)).toEqual([
			"createApplicationSchema",
			"createCollection",
			"createCollection",
			"createCollection",
			"createCollection",
			"createCollection",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addConstraint",
			"addRelation",
			"addRelation",
			"addRelation",
			"addRelation",
			"addRelation",
			"addIndex",
		]);

		const committed = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			planDigest: planned.digest,
		});
		expect(committed.identity).toBe("000001_create-collaboration");
		expect(Object.keys(committed.files).sort()).toEqual([
			"base-schema.json",
			"checksum.sha256",
			"migration.json",
			"plan.json",
			"target-schema.json",
			"up.sql",
		]);
		expect(committed.files["up.sql"]).toContain(
			'CREATE SCHEMA "collaboration";',
		);
		expect(committed.files["up.sql"]).not.toMatch(
			/CONCURRENTLY|ROW LEVEL SECURITY|CREATE POLICY/,
		);
	});
});
