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
import type { RenameIdentityV1, SchemaProjectionV1 } from "@questpie/compiler";

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

function commitDelta(
	baseSchema: SchemaProjectionV1,
	targetSchema: SchemaProjectionV1,
	slug: string,
	renames: readonly Readonly<{
		from: RenameIdentityV1;
		to: RenameIdentityV1;
	}>[],
) {
	const genesisPlan = createMigrationPlan({
		targetSchema: baseSchema,
		slug: "create-rename-fixture",
	});
	const genesis = createCommittedMigration({
		plan: genesisPlan.plan,
		baseSchema: genesisPlan.baseSchema,
		targetSchema: baseSchema,
		currentSchema: baseSchema,
		planDigest: genesisPlan.digest,
		localMigrations: [],
	});
	const planned = createMigrationPlan({
		baseMigration: genesis.identity,
		baseSchema,
		targetSchema,
		slug,
		renames,
	});
	if (planned.status !== "planned") throw new Error("delta plan disappeared");
	const committed = createCommittedMigration({
		plan: planned.plan,
		baseSchema,
		targetSchema,
		currentSchema: targetSchema,
		planDigest: planned.digest,
		localMigrations: [genesis],
		acceptDestructive: planned.digest,
	});
	return { committed, planned };
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

	test("orders renamed constraint, Index, and generated-bound replacements exactly", async () => {
		const compilation = await compiledFixture;
		const collaboration = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const companiesOnly = structuredClone(collaboration);
		companiesOnly.collections = collaboration.collections.filter(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);

		const collectionFrom = "collection:companies";
		const collectionTo = "collection:organizations";
		const constraintTarget = replaceIdentity(
			companiesOnly,
			collectionFrom,
			collectionTo,
		) as typeof companiesOnly;
		const organizations = constraintTarget.collections[0];
		organizations.postgresName = "organizations";
		for (const constraint of organizations.constraints)
			constraint.postgresName = String(constraint.postgresName).replace(
				"companies",
				"organizations",
			);
		const changedConstraint = organizations.constraints.find(
			(constraint: { identity: string }) =>
				constraint.identity.endsWith("invariant:minLength"),
		);
		changedConstraint.expression.right.value = 2;
		const constraint = commitDelta(
			companiesOnly,
			constraintTarget,
			"rename-and-change-constraint",
			[{ from: collectionFrom, to: collectionTo }],
		);
		expect(
			constraint.planned.plan.steps.map((step) => [
				step.kind,
				step.targetIdentity,
			]),
		).toEqual([
			["renameCollection", "collection:organizations"],
			["renameConstraint", "collection:organizations/constraint:primary"],
			[
				"renameConstraint",
				"collection:organizations/field:name/invariant:maxLength",
			],
			[
				"renameConstraint",
				"collection:organizations/field:name/invariant:minLength",
			],
			["dropConstraint", "collection:companies/field:name/invariant:minLength"],
			[
				"addConstraint",
				"collection:organizations/field:name/invariant:minLength",
			],
		]);

		const indexedBase = structuredClone(companiesOnly);
		indexedBase.collections[0].indexes = [
			{
				fields: [
					{
						collation: "questpie.binary",
						field: "collection:companies/field:name",
						nulls: "last",
						operatorClass: "typeDefault",
						order: "asc",
					},
				],
				identity: "collection:companies/index:byName",
				kind: "btree",
				postgresName: "qp_ix_companies_by_name",
				unique: false,
			},
		];
		const indexTarget = replaceIdentity(
			indexedBase,
			collectionFrom,
			collectionTo,
		) as typeof indexedBase;
		indexTarget.collections[0].postgresName = "organizations";
		for (const item of indexTarget.collections[0].constraints)
			item.postgresName = String(item.postgresName).replace(
				"companies",
				"organizations",
			);
		const changedIndex = indexTarget.collections[0].indexes[0];
		changedIndex.postgresName = "qp_ix_organizations_by_name";
		changedIndex.fields[0].field = "collection:organizations/field:id";
		changedIndex.fields[0].collation = null;
		const index = commitDelta(
			indexedBase,
			indexTarget,
			"rename-and-change-index",
			[{ from: collectionFrom, to: collectionTo }],
		);
		expect(
			index.planned.plan.steps
				.filter((step) => step.kind.endsWith("Index"))
				.map((step) => [step.kind, step.targetIdentity]),
		).toEqual([
			["renameIndex", "collection:organizations/index:byName"],
			["dropIndex", "collection:companies/index:byName"],
			["addIndex", "collection:organizations/index:byName"],
		]);

		const fieldFrom = "collection:companies/field:name";
		const fieldTo = "collection:companies/field:title";
		const boundTarget = replaceIdentity(
			companiesOnly,
			fieldFrom,
			fieldTo,
		) as typeof companiesOnly;
		const title = boundTarget.collections[0].fields.find(
			(field: { identity: string }) => field.identity === fieldTo,
		);
		title.path = ["title"];
		title.postgresName = "title";
		title.type.minLength = 2;
		for (const item of boundTarget.collections[0].constraints)
			if (String(item.identity).startsWith(`${fieldTo}/`))
				item.postgresName = String(item.postgresName).replace("name", "title");
		const minimum = boundTarget.collections[0].constraints.find(
			(item: { identity: string }) =>
				item.identity.endsWith("invariant:minLength"),
		);
		minimum.expression.right.value = 2;
		const bound = commitDelta(
			companiesOnly,
			boundTarget,
			"rename-and-change-generated-bound",
			[{ from: fieldFrom, to: fieldTo }],
		);
		expect(
			bound.planned.plan.steps.map((step) => [step.kind, step.targetIdentity]),
		).toEqual([
			["renameField", "collection:companies/field:title"],
			[
				"renameConstraint",
				"collection:companies/field:title/invariant:maxLength",
			],
			[
				"renameConstraint",
				"collection:companies/field:title/invariant:minLength",
			],
			["dropConstraint", "collection:companies/field:name/invariant:minLength"],
			["addConstraint", "collection:companies/field:title/invariant:minLength"],
		]);

		expect(bound.committed.files["up.sql"]).toMatchSnapshot(
			"renamed generated bound up.sql",
		);
		expect(constraint.committed.files["up.sql"]).toMatchSnapshot(
			"renamed constraint up.sql",
		);
		expect(index.committed.files["up.sql"]).toMatchSnapshot(
			"renamed Index up.sql",
		);
	});

	test("commits semantic renames with stable physical names without empty DDL", async () => {
		const compilation = await compiledFixture;
		const collaboration = JSON.parse(
			compilation.generatedFiles["schema-projection.json"] ?? "null",
		);
		const companiesOnly = structuredClone(collaboration);
		companiesOnly.collections = collaboration.collections.filter(
			(collection: { identity: string }) =>
				collection.identity === "collection:companies",
		);

		const collectionTarget = replaceIdentity(
			companiesOnly,
			"collection:companies",
			"collection:organizations",
		) as typeof companiesOnly;
		const collection = commitDelta(
			companiesOnly,
			collectionTarget,
			"rename-collection-semantically",
			[
				{
					from: "collection:companies",
					to: "collection:organizations",
				},
			],
		);
		expect(collection.planned.plan).toMatchObject({
			classification: "destructive",
			renames: [
				{
					from: "collection:companies",
					to: "collection:organizations",
				},
			],
			steps: [],
		});
		expect(collection.committed.files["up.sql"]).toBe("");
		expect(() => verifyCommittedMigration(collection.committed)).not.toThrow();

		const fieldTarget = replaceIdentity(
			companiesOnly,
			"collection:companies/field:name",
			"collection:companies/field:title",
		) as typeof companiesOnly;
		const title = fieldTarget.collections[0].fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:companies/field:title",
		);
		title.path = ["title"];
		const field = commitDelta(
			companiesOnly,
			fieldTarget,
			"rename-field-semantically",
			[
				{
					from: "collection:companies/field:name",
					to: "collection:companies/field:title",
				},
			],
		);
		expect(field.planned.plan).toMatchObject({
			classification: "destructive",
			steps: [],
		});
		expect(field.committed.files["up.sql"]).toBe("");
		expect(() => verifyCommittedMigration(field.committed)).not.toThrow();
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
