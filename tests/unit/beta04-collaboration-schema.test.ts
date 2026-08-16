import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	loadCommittedMigration,
	verifyCommittedMigrationChain,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compiledFixture = compileApplication({ applicationRoot: fixtureRoot });

test("projects the mutable membership evidence and stable Message page index", async () => {
	const compilation = await compiledFixture;
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"] ?? "null",
	) as {
		collections: Array<{
			identity: string;
			fields: Array<{ identity: string }>;
			constraints: Array<{
				identity: string;
				kind: string;
				fields?: string[];
			}>;
			indexes: Array<{
				identity: string;
				fields: Array<{
					field: string;
					order: string;
					nulls: string;
				}>;
			}>;
		}>;
	};
	const collection = (identity: string) =>
		schema.collections.find((item) => item.identity === identity)!;

	expect(
		collection("collection:memberships").fields.map(({ identity }) => identity),
	).toEqual([
		"collection:memberships/field:companyId",
		"collection:memberships/field:id",
		"collection:memberships/field:principalId",
		"collection:memberships/field:role",
		"collection:memberships/field:scopeKey",
		"collection:memberships/field:status",
	]);
	expect(
		collection("collection:memberships").constraints.find(
			({ kind }) => kind === "primaryKey",
		)?.fields,
	).toEqual([
		"collection:memberships/field:companyId",
		"collection:memberships/field:principalId",
		"collection:memberships/field:scopeKey",
	]);
	expect(collection("collection:channels").fields).toContainEqual(
		expect.objectContaining({
			identity: "collection:channels/field:visibility",
		}),
	);
	const page = collection("collection:messages").indexes.find(
		({ identity }) => identity === "collection:messages/index:page",
	)!;
	expect(
		page.fields.map(({ field, order, nulls }) => ({ field, order, nulls })),
	).toEqual([
		{
			field: "collection:messages/field:channelId",
			order: "asc",
			nulls: "last",
		},
		{
			field: "collection:messages/field:id",
			order: "desc",
			nulls: "last",
		},
	]);
});

test("extends the frozen authorization schema with the publish migration", async () => {
	const compilation = await compiledFixture;
	const current = JSON.parse(
		compilation.generatedFiles["schema-projection.json"] ?? "null",
	);
	const genesis = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
	);
	const authorization = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000002_authorize-message-pages"),
	);
	const publication = await loadCommittedMigration(
		resolve(
			fixtureRoot,
			"questpie/migrations/000003_publish-message-transaction",
		),
	);

	expect(() =>
		verifyCommittedMigrationChain([genesis, authorization, publication]),
	).not.toThrow();
	expect(authorization.targetSchema).toEqual(publication.baseSchema);
	expect(publication.targetSchema).toEqual(current);
	expect(publication.plan.baseMigration).toBe(authorization.identity);
	expect(publication.plan.classification).toBe("guarded");
	expect(publication.files["up.sql"]).toContain(
		'CREATE TABLE "collaboration"."message_events"',
	);
	expect(authorization.plan.classification).toBe("destructive");
	expect(authorization.files["up.sql"]).toContain(
		'CREATE INDEX "qp_ix_messages_page"',
	);
	expect(authorization.files["up.sql"]).toContain(
		'ADD COLUMN "scope_key" pg_catalog.text',
	);
	const orderedSteps = authorization.plan.steps.map(
		({ kind, targetIdentity }) => `${kind}:${targetIdentity}`,
	);
	const dependentRelation = "collection:messages/relation:author";
	const replacedPrimary = "collection:memberships/constraint:primary";
	const dropRelation = orderedSteps.indexOf(
		`dropRelation:${dependentRelation}`,
	);
	const dropPrimary = orderedSteps.indexOf(`dropConstraint:${replacedPrimary}`);
	const addPrimary = orderedSteps.indexOf(`addConstraint:${replacedPrimary}`);
	const addRelation = orderedSteps.indexOf(`addRelation:${dependentRelation}`);

	expect(dropRelation).toBeGreaterThanOrEqual(0);
	expect(dropRelation).toBeLessThan(dropPrimary);
	expect(addRelation).toBeGreaterThan(addPrimary);
	expect(authorization.files["up.sql"]).toContain(
		'ALTER TABLE "collaboration"."messages" DROP CONSTRAINT "qp_fk_messages_author";',
	);
	expect(
		authorization.files["up.sql"].lastIndexOf("qp_fk_messages_author"),
	).toBeGreaterThan(
		authorization.files["up.sql"].lastIndexOf("qp_pk_memberships_primary"),
	);
});

test("drops a physically renamed dependent Relation by its current name", async () => {
	const compilation = await compiledFixture;
	const target = JSON.parse(
		compilation.generatedFiles["schema-projection.json"] ?? "null",
	);
	const messages = target.collections.find(
		(collection: { identity: string }) =>
			collection.identity === "collection:messages",
	);
	const author = messages.relations.find(
		(relation: { identity: string }) =>
			relation.identity === "collection:messages/relation:author",
	);
	author.constraintPostgresName = "renamed_messages_author_fk";
	const genesis = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000001_create-collaboration"),
	);
	const planned = createMigrationPlan({
		baseSchema: genesis.targetSchema,
		targetSchema: target,
		baseMigration: genesis.identity,
		slug: "rename-author-and-replace-membership-key",
	});
	if (planned.status !== "planned")
		throw new Error("expected a Migration Plan");
	const committed = createCommittedMigration({
		plan: planned.plan,
		baseSchema: genesis.targetSchema,
		targetSchema: target,
		planDigest: planned.digest,
		localMigrations: [genesis],
		currentSchema: target,
		acceptDestructive: planned.digest,
	});

	expect(committed.files["up.sql"]).toContain(
		'RENAME CONSTRAINT "qp_fk_messages_author" TO "renamed_messages_author_fk";',
	);
	expect(committed.files["up.sql"]).toContain(
		'DROP CONSTRAINT "renamed_messages_author_fk";',
	);
});
