import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
	compileApplication,
	createCommittedMigration,
	createMigrationPlan,
	loadCommittedMigration,
} from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/archive");

test("archive compiles the existing kernels without tenant, CRUD, or collaboration assumptions", async () => {
	const compilation = await compileApplication({
		applicationRoot: fixtureRoot,
	});
	const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"]!,
	);
	const policies = JSON.parse(
		compilation.generatedFiles["policy-projection.json"]!,
	);
	const operations = JSON.parse(
		compilation.generatedFiles["operation-contracts.json"]!,
	);
	const reactions = JSON.parse(
		compilation.generatedFiles["reaction-projection.json"]!,
	);
	const queryPlans = JSON.parse(
		compilation.generatedFiles["postgres-query-plans.json"]!,
	);

	expect(manifest.application.name).toBe("archive");
	expect(
		schema.collections.map(({ identity }: { identity: string }) => identity),
	).toEqual([
		"collection:embargoes",
		"collection:institutions",
		"collection:provenance",
		"collection:records",
		"collection:researchPermits",
	]);
	expect(
		schema.collections.find(
			({ identity }: { identity: string }) => identity === "collection:records",
		)?.constraints,
	).toContainEqual(
		expect.objectContaining({
			kind: "primaryKey",
			fields: [
				"collection:records/field:archiveCode",
				"collection:records/field:catalogueNumber",
			],
		}),
	);

	const policyBytes = JSON.stringify(policies);
	expect(policyBytes).toContain("collection:researchPermits");
	expect(policyBytes).toContain("collection:embargoes");
	expect(policyBytes).not.toContain('"source":"tenant"');

	const operationIdentities = operations.operations.map(
		({ identity }: { identity: string }) => identity,
	);
	expect(operationIdentities).toContain("mutation:record.deposit");
	expect(operationIdentities).toContain("query:records.page");
	expect(operationIdentities).not.toContain("mutation:records.update");
	expect(operationIdentities).not.toContain("mutation:records.delete");
	expect(operationIdentities).not.toContain("mutation:provenance.update");
	expect(operationIdentities).not.toContain("mutation:provenance.delete");
	expect(reactions.reactions).toContainEqual(
		expect.objectContaining({ identity: "reaction:recordDeposited" }),
	);
	const recordPagePlan = queryPlans.plans.find(
		({ policy }: { policy: string }) => policy === "policy:records.default",
	);
	expect(recordPagePlan.binding.parameters).toContainEqual({
		kind: "scalar",
		name: "archiveCode",
		codec: {
			kind: "text",
			minLength: null,
			maxLength: null,
			collation: "questpie.binary",
		},
		nullable: false,
	});
	const migration = await loadCommittedMigration(
		resolve(fixtureRoot, "questpie/migrations/000001_create-archive"),
	);
	const planned = createMigrationPlan({
		targetSchema: schema,
		slug: "create-archive",
	});
	if (planned.status === "noChanges")
		throw new Error("expected archive genesis");
	const reproduced = createCommittedMigration({
		plan: planned.plan,
		baseSchema: planned.baseSchema,
		targetSchema: schema,
		currentSchema: schema,
		planDigest: planned.digest,
		localMigrations: [],
	});
	expect(reproduced.identity).toBe("000001_create-archive");
	expect(reproduced.files).toEqual(migration.files);
	expect(migration.files["up.sql"]).not.toMatch(
		/ROW LEVEL SECURITY|CREATE POLICY/,
	);

	for (const bytes of Object.values(compilation.generatedFiles))
		expect(bytes).not.toContain("collaboration");
});
