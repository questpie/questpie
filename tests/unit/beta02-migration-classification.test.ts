import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication, createMigrationPlan } from "@questpie/compiler";

async function collaborationSchema() {
	const compilation = await compileApplication({
		applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
	});
	return JSON.parse(
		compilation.generatedFiles["schema-projection.json"] ?? "null",
	);
}

test("returns noChanges without producing Migration Plan bytes", async () => {
	const schema = await collaborationSchema();

	const result = createMigrationPlan({
		baseSchema: schema,
		targetSchema: structuredClone(schema),
		baseMigration: "000001_create-collaboration",
		slug: "unchanged",
	});

	expect(result).toEqual({ status: "noChanges" });
	expect("plan" in result).toBe(false);
	expect("digest" in result).toBe(false);
});

test("classifies the closed PostgreSQL provider delta matrix", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{
			name: "add extension",
			base: schema.requiredPostgres,
			target: {
				...schema.requiredPostgres,
				extensions: [{ name: "pgcrypto" }],
			},
			expected: "guarded",
		},
		{
			name: "remove extension",
			base: { ...schema.requiredPostgres, extensions: [{ name: "pgcrypto" }] },
			target: schema.requiredPostgres,
			expected: "safe",
		},
		{
			name: "increase minimum major",
			base: schema.requiredPostgres,
			target: { ...schema.requiredPostgres, minimumMajor: 17 },
			expected: "guarded",
		},
		{
			name: "lower minimum major",
			base: { ...schema.requiredPostgres, minimumMajor: 17 },
			target: schema.requiredPostgres,
			expected: "safe",
		},
		{
			name: "change database collation",
			base: schema.requiredPostgres,
			target: { ...schema.requiredPostgres, databaseCollation: "en_US.UTF-8" },
			expected: "blocked",
		},
		{
			name: "change database ctype",
			base: schema.requiredPostgres,
			target: { ...schema.requiredPostgres, databaseCType: "en_US.UTF-8" },
			expected: "blocked",
		},
	] as const;

	for (const scenario of cases) {
		const result = createMigrationPlan({
			baseSchema: { ...schema, requiredPostgres: scenario.base },
			targetSchema: { ...schema, requiredPostgres: scenario.target },
			baseMigration: "000001_create-collaboration",
			slug: `provider-${scenario.name.replaceAll(" ", "-")}`,
		});
		expect(result.status, scenario.name).toBe("planned");
		if (result.status !== "planned") throw new Error(scenario.name);
		expect(result.plan.steps, scenario.name).toEqual([]);
		expect(result.plan.classification, scenario.name).toBe(scenario.expected);
	}
});

test("classifies added Fields by literal backfill safety", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{ name: "nullable-empty", nullable: true, default: null, expected: "safe" },
		{
			name: "nullable-literal",
			nullable: true,
			default: { kind: "literal", value: 7 },
			expected: "guarded",
		},
		{
			name: "required-literal",
			nullable: false,
			default: { kind: "literal", value: 7 },
			expected: "destructive",
		},
		{
			name: "required-empty",
			nullable: false,
			default: null,
			expected: "blocked",
		},
		{
			name: "nullable-now",
			nullable: true,
			default: { kind: "now" },
			expected: "blocked",
		},
		{
			name: "required-random",
			nullable: false,
			default: { kind: "randomUuid" },
			expected: "blocked",
		},
	] as const;

	for (const scenario of cases) {
		const target = structuredClone(schema);
		const messages = target.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		if (!messages) throw new Error("Messages schema is missing");
		messages.fields.push({
			collation: null,
			default: scenario.default,
			identity: `collection:messages/field:${scenario.name}`,
			nullable: scenario.nullable,
			path: [scenario.name],
			postgresName: scenario.name.replaceAll("-", "_"),
			type: { kind: scenario.name.includes("random") ? "uuid" : "integer" },
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
		const result = createMigrationPlan({
			baseSchema: schema,
			targetSchema: target,
			baseMigration: "000001_create-collaboration",
			slug: `add-${scenario.name}`,
		});
		expect(result.status, scenario.name).toBe("planned");
		if (result.status !== "planned") throw new Error(scenario.name);
		const added = result.plan.steps.find((step) => step.kind === "addField");
		expect(added?.classification, scenario.name).toBe(scenario.expected);
		expect(result.plan.classification, scenario.name).toBe(scenario.expected);
	}
});
