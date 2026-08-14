import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	verifyCommittedMigration,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compiledFixture = compileApplication({ applicationRoot: fixtureRoot });

function replaceIdentity(value: unknown, from: string, to: string): unknown {
	if (typeof value === "string")
		return value === from || value.startsWith(`${from}/`)
			? `${to}${value.slice(from.length)}`
			: value;
	if (Array.isArray(value))
		return value.map((item) => replaceIdentity(item, from, to));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [
			key,
			replaceIdentity(item, from, to),
		]),
	);
}

describe("BETA-02 migration artifacts", () => {
	test("plans and commits the collaboration Genesis migration exactly", async () => {
		const compilation = await compiledFixture;
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
			currentSchema: targetSchema,
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

	test("never infers a Field rename and consumes an explicit one-to-one mapping", async () => {
		const compilation = await compiledFixture;
		const baseSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const from = "collection:channels/field:name";
		const to = "collection:channels/field:title";
		const targetSchema = replaceIdentity(
			baseSchema,
			from,
			to,
		) as typeof baseSchema;
		const channels = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:channels",
		);
		const title = channels.fields.find(
			(field: { identity: string }) => field.identity === to,
		);
		title.path = ["title"];
		title.postgresName = "title";
		for (const constraint of channels.constraints)
			if (String(constraint.identity).startsWith(`${to}/`))
				constraint.postgresName = String(constraint.postgresName).replace(
					"name",
					"title",
				);

		const implicit = createMigrationPlan({
			baseSchema,
			targetSchema,
			baseMigration: "000001_create-collaboration",
			slug: "rename-channel-name",
		});
		expect(implicit.plan.steps.map((item) => item.kind)).toEqual([
			"addField",
			"addConstraint",
			"addConstraint",
			"dropConstraint",
			"dropConstraint",
			"dropField",
		]);

		const explicit = createMigrationPlan({
			baseSchema,
			targetSchema,
			baseMigration: "000001_create-collaboration",
			slug: "rename-channel-name",
			renames: [{ from, to }],
		});
		expect(explicit.plan.steps.map((item) => item.kind)).toEqual([
			"renameField",
			"renameConstraint",
			"renameConstraint",
		]);
		const committed = createCommittedMigration({
			plan: explicit.plan,
			baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: explicit.digest,
			sequence: 2,
			parent: "000001_create-collaboration",
			acceptDestructive: explicit.digest,
		});
		expect(committed.files["up.sql"]).toContain(
			'RENAME COLUMN "name" TO "title"',
		);
		expect(() =>
			createMigrationPlan({
				baseSchema,
				targetSchema,
				baseMigration: "000001_create-collaboration",
				slug: "invalid-rename",
				renames: [
					{ from, to },
					{ from, to: "collection:channels/field:other" },
				],
			}),
		).toThrow(/QP-SCHEMA-001/);
	});

	test("refuses stale plans and tampered committed bytes", async () => {
		const compilation = await compiledFixture;
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-collaboration",
		});
		const staleSchema = structuredClone(targetSchema);
		staleSchema.collections = staleSchema.collections.slice(1);
		expect(() =>
			createCommittedMigration({
				plan: planned.plan,
				baseSchema: planned.baseSchema,
				targetSchema,
				currentSchema: staleSchema,
				planDigest: planned.digest,
			}),
		).toThrow(/QP-SCHEMA-022/);

		const committed = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
		});
		const tampered = {
			...committed,
			files: {
				...committed.files,
				"up.sql": `${committed.files["up.sql"]}\n-- tampered`,
			},
		};
		expect(() => verifyCommittedMigration(tampered)).toThrow(/QP-SCHEMA-023/);
	});
});
