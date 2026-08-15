import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	loadCommittedMigration,
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
			localMigrations: [],
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

	test("loads the committed six-file collaboration migration byte for byte", async () => {
		const compilation = await compiledFixture;
		const targetSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const planned = createMigrationPlan({
			targetSchema,
			slug: "create-collaboration",
		});
		const expected = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
		});
		const committed = await loadCommittedMigration(
			resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
		);

		expect(committed).toEqual(expected);
		expect(
			Object.fromEntries(
				Object.entries(committed.files).map(([name, bytes]) => [
					name,
					Buffer.byteLength(bytes),
				]),
			),
		).toMatchSnapshot();
	});

	test("does not recreate the application schema after an empty applied head", async () => {
		const compilation = await compiledFixture;
		const collaboration = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const baseSchema = structuredClone(collaboration);
		baseSchema.collections = [];
		const targetSchema = structuredClone(baseSchema);
		targetSchema.collections = collaboration.collections.filter(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);

		const planned = createMigrationPlan({
			baseMigration: "000002_drop-all-collections",
			baseSchema,
			targetSchema,
			slug: "restore-companies",
		});

		expect(planned.status).toBe("planned");
		if (planned.status !== "planned") throw new Error("plan disappeared");
		expect(planned.plan.steps.map((step) => step.kind)).toEqual([
			"createCollection",
			"addConstraint",
			"addConstraint",
			"addConstraint",
		]);
		expect(planned.plan.classification).toBe("guarded");
		expect(planned.plan.steps).not.toContainEqual(
			expect.objectContaining({ kind: "createApplicationSchema" }),
		);
	});

	test("refuses an extra file in the committed migration directory", async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-migration-"));
		try {
			const directory = join(temporary, "000001_create-collaboration");
			await cp(
				resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
				directory,
				{ recursive: true },
			);
			await writeFile(join(directory, "notes.txt"), "not reviewed\n");
			await expect(loadCommittedMigration(directory)).rejects.toThrow(
				/QP-SCHEMA-023/,
			);
		} finally {
			await rm(temporary, { recursive: true });
		}
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
		const genesis = await loadCommittedMigration(
			resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
		);
		const committed = createCommittedMigration({
			plan: explicit.plan,
			baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: explicit.digest,
			localMigrations: [genesis],
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
				localMigrations: [],
			}),
		).toThrow(/QP-SCHEMA-022/);

		const committed = createCommittedMigration({
			plan: planned.plan,
			baseSchema: planned.baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: planned.digest,
			localMigrations: [],
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

	test("allocates identity from the exact local migration head", async () => {
		const compilation = await compiledFixture;
		const baseSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const genesisPlan = createMigrationPlan({
			targetSchema: baseSchema,
			slug: "create-collaboration",
		});
		const genesis = createCommittedMigration({
			plan: genesisPlan.plan,
			baseSchema: genesisPlan.baseSchema,
			targetSchema: baseSchema,
			currentSchema: baseSchema,
			planDigest: genesisPlan.digest,
			localMigrations: [],
		});
		const targetSchema = structuredClone(baseSchema);
		const messages = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		messages.fields.push({
			collation: "questpie.binary",
			default: null,
			identity: "collection:messages/field:summary",
			nullable: true,
			path: ["summary"],
			postgresName: "summary",
			type: {
				collation: "questpie.binary",
				kind: "text",
				maxLength: null,
				minLength: null,
			},
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		const nextPlan = createMigrationPlan({
			baseSchema,
			targetSchema,
			baseMigration: genesis.identity,
			slug: "add-summary",
		});
		expect(nextPlan.status).toBe("planned");
		if (nextPlan.status !== "planned") throw new Error("next plan disappeared");
		const next = createCommittedMigration({
			plan: nextPlan.plan,
			baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: nextPlan.digest,
			localMigrations: [genesis],
		});

		expect(next.identity).toBe("000002_add-summary");
		expect(() =>
			createCommittedMigration({
				plan: nextPlan.plan,
				baseSchema,
				targetSchema,
				currentSchema: targetSchema,
				planDigest: nextPlan.digest,
				localMigrations: [genesis, next],
			}),
		).toThrow(/QP-SCHEMA-022/);
	});

	test("renders canonical bigint bound SQL", async () => {
		const compilation = await compiledFixture;
		const baseSchema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const messages = baseSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		const bodyMinimum = messages.constraints.find(
			(constraint: { identity: string }) =>
				constraint.identity ===
				"collection:messages/field:body/invariant:minLength",
		);
		const identity = "collection:messages/field:largeSequence";
		messages.fields.push({
			collation: null,
			default: null,
			identity,
			nullable: true,
			path: ["largeSequence"],
			postgresName: "large_sequence",
			type: { kind: "bigint", maximum: null, minimum: "10" },
		});
		messages.constraints.push({
			...structuredClone(bodyMinimum),
			identity: `${identity}/invariant:minimum`,
			postgresName: "qp_ck_messages_large_sequence_minimum",
			expression: {
				kind: "compare",
				left: { kind: "field", field: identity },
				operator: "greaterThanOrEqual",
				right: { kind: "literal", value: "10" },
			},
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		messages.constraints.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		const genesisPlan = createMigrationPlan({
			targetSchema: baseSchema,
			slug: "create-bigint-bound",
		});
		const genesis = createCommittedMigration({
			plan: genesisPlan.plan,
			baseSchema: genesisPlan.baseSchema,
			targetSchema: baseSchema,
			currentSchema: baseSchema,
			planDigest: genesisPlan.digest,
			localMigrations: [],
		});
		expect(genesis.files["up.sql"]).toContain(
			"(\"large_sequence\" >= CAST('10' AS pg_catalog.int8))",
		);

		const targetSchema = structuredClone(baseSchema);
		const targetMessages = targetSchema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		targetMessages.fields.find(
			(field: { identity: string }) => field.identity === identity,
		).type.minimum = "9";
		targetMessages.constraints.find(
			(constraint: { identity: string }) =>
				constraint.identity === `${identity}/invariant:minimum`,
		).expression.right.value = "9";
		const nextPlan = createMigrationPlan({
			baseSchema,
			targetSchema,
			baseMigration: genesis.identity,
			slug: "relax-bigint-bound",
		});
		expect(nextPlan.status).toBe("planned");
		if (nextPlan.status !== "planned")
			throw new Error("bound plan disappeared");
		const next = createCommittedMigration({
			plan: nextPlan.plan,
			baseSchema,
			targetSchema,
			currentSchema: targetSchema,
			planDigest: nextPlan.digest,
			localMigrations: [genesis],
		});
		expect(next.files["up.sql"]).toContain(
			"(\"large_sequence\" >= CAST('9' AS pg_catalog.int8))",
		);
		expect(
			next.files["up.sql"].indexOf(
				'DROP CONSTRAINT "qp_ck_messages_large_sequence_minimum"',
			),
		).toBeLessThan(
			next.files["up.sql"].indexOf(
				'ADD CONSTRAINT "qp_ck_messages_large_sequence_minimum"',
			),
		);
	});
});
