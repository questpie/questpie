import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication, createMigrationPlan } from "@questpie/compiler";

const compiledSchema = compileApplication({
	applicationRoot: resolve(import.meta.dir, "../../fixtures/collaboration"),
}).then((compilation) =>
	JSON.parse(compilation.generatedFiles["schema-projection.json"] ?? "null"),
);

async function collaborationSchema() {
	return structuredClone(await compiledSchema);
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

test("classifies changed Field storage, default, and nullability", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{
			name: "add-literal-default",
			field: "auditId",
			mutate: (field: Record<string, unknown>) => {
				field.default = {
					kind: "literal",
					value: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6172",
				};
			},
			expected: "guarded",
		},
		{
			name: "drop-default",
			field: "createdAt",
			mutate: (field: Record<string, unknown>) => {
				field.default = null;
			},
			expected: "destructive",
		},
		{
			name: "required-to-nullable",
			field: "body",
			mutate: (field: Record<string, unknown>) => {
				field.nullable = true;
			},
			expected: "destructive",
		},
		{
			name: "nullable-to-required-with-literal",
			field: "auditId",
			mutate: (field: Record<string, unknown>) => {
				field.nullable = false;
				field.default = {
					kind: "literal",
					value: "018f5f6e-5f2c-7b41-a854-3d9a6b6b6172",
				};
			},
			expected: "destructive",
		},
		{
			name: "nullable-to-required-without-literal",
			field: "auditId",
			mutate: (field: Record<string, unknown>) => {
				field.nullable = false;
			},
			expected: "blocked",
		},
		{
			name: "unsupported-kind-change",
			field: "auditId",
			mutate: (field: Record<string, unknown>) => {
				field.type = {
					collation: "questpie.binary",
					kind: "text",
					maxLength: null,
					minLength: null,
				};
			},
			expected: "blocked",
		},
		{
			name: "timestamp-timezone-change",
			field: "createdAt",
			mutate: (field: Record<string, unknown>) => {
				field.type = { kind: "timestamp", withTimezone: false };
			},
			expected: "blocked",
		},
	] as const;

	for (const scenario of cases) {
		const base = structuredClone(schema);
		const target = structuredClone(schema);
		const targetMessages = target.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		const field = targetMessages?.fields.find(
			(candidate: { path: string[] }) => candidate.path[0] === scenario.field,
		);
		if (!field) throw new Error(`${scenario.name} Field is missing`);
		scenario.mutate(field);
		const result = createMigrationPlan({
			baseSchema: base,
			targetSchema: target,
			baseMigration: "000001_create-collaboration",
			slug: scenario.name,
		});
		expect(result.status, scenario.name).toBe("planned");
		if (result.status !== "planned") throw new Error(scenario.name);
		const altered = result.plan.steps.find(
			(step) => step.kind === "alterField",
		);
		expect(altered?.classification, scenario.name).toBe(scenario.expected);
		expect(result.plan.classification, scenario.name).toBe(scenario.expected);
	}

	const integerBase = structuredClone(schema);
	const integerTarget = structuredClone(schema);
	for (const projection of [integerBase, integerTarget]) {
		const messages = projection.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		messages.fields.push({
			collation: null,
			default: null,
			identity: "collection:messages/field:sequence",
			nullable: true,
			path: ["sequence"],
			postgresName: "sequence",
			type: { kind: "integer", maximum: null, minimum: null },
		});
		messages.fields.sort(
			(left: { identity: string }, right: { identity: string }) =>
				left.identity.localeCompare(right.identity),
		);
	}
	const integerTargetField = integerTarget.collections
		.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		)
		.fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:messages/field:sequence",
		);
	integerTargetField.type = { kind: "bigint", maximum: null, minimum: null };
	const widened = createMigrationPlan({
		baseSchema: integerBase,
		targetSchema: integerTarget,
		baseMigration: "000001_create-collaboration",
		slug: "widen-integer",
	});
	expect(widened.status).toBe("planned");
	if (widened.status !== "planned") throw new Error("widening disappeared");
	expect(widened.plan.steps).toContainEqual(
		expect.objectContaining({
			kind: "alterField",
			classification: "guarded",
		}),
	);
});

test("classifies text bound constraints with their owning Field", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{ name: "relax-minimum", bound: "minLength", value: 0, expected: "safe" },
		{
			name: "strengthen-minimum",
			bound: "minLength",
			value: 2,
			expected: "destructive",
		},
		{
			name: "relax-maximum",
			bound: "maxLength",
			value: 9_000,
			expected: "safe",
		},
		{
			name: "strengthen-maximum",
			bound: "maxLength",
			value: 8_000,
			expected: "destructive",
		},
	] as const;

	for (const scenario of cases) {
		const target = structuredClone(schema);
		const messages = target.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		const body = messages?.fields.find(
			(field: { identity: string }) =>
				field.identity === "collection:messages/field:body",
		);
		const constraint = messages?.constraints.find(
			(candidate: { identity: string }) =>
				candidate.identity ===
				`collection:messages/field:body/invariant:${scenario.bound}`,
		);
		if (!body || !constraint)
			throw new Error(`${scenario.name} projection member is missing`);
		body.type[scenario.bound] = scenario.value;
		constraint.expression.right.value = scenario.value;

		const result = createMigrationPlan({
			baseSchema: schema,
			targetSchema: target,
			baseMigration: "000001_create-collaboration",
			slug: scenario.name,
		});
		expect(result.status, scenario.name).toBe("planned");
		if (result.status !== "planned") throw new Error(scenario.name);
		expect(
			result.plan.steps.some((step) => step.kind === "alterField"),
			scenario.name,
		).toBe(false);
		const constraintSteps = result.plan.steps.filter((step) =>
			step.targetIdentity.endsWith(`/invariant:${scenario.bound}`),
		);
		expect(constraintSteps, scenario.name).toHaveLength(2);
		expect(
			constraintSteps.map((step) => step.classification),
			scenario.name,
		).toEqual([scenario.expected, scenario.expected]);
		expect(result.plan.classification, scenario.name).toBe(scenario.expected);
	}
});

test("classifies integer and bigint bound constraints", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{ kind: "integer", before: 10, after: 9, expected: "safe" },
		{ kind: "integer", before: 10, after: 11, expected: "destructive" },
		{ kind: "bigint", before: "10", after: "9", expected: "safe" },
		{ kind: "bigint", before: "10", after: "11", expected: "destructive" },
	] as const;

	for (const [index, scenario] of cases.entries()) {
		const base = structuredClone(schema);
		const target = structuredClone(schema);
		for (const projection of [base, target]) {
			const messages = projection.collections.find(
				(collection: { identity: string }) =>
					collection.identity === "collection:messages",
			);
			const body = messages.fields.find(
				(field: { identity: string }) =>
					field.identity === "collection:messages/field:body",
			);
			const minimum = messages.constraints.find(
				(constraint: { identity: string }) =>
					constraint.identity ===
					"collection:messages/field:body/invariant:minLength",
			);
			const identity = `collection:messages/field:${scenario.kind}Bound`;
			messages.fields.push({
				...structuredClone(body),
				collation: null,
				identity,
				path: [`${scenario.kind}Bound`],
				postgresName: `${scenario.kind}_bound`,
				type: {
					kind: scenario.kind,
					maximum: null,
					minimum: scenario.before,
				},
			});
			messages.constraints.push({
				...structuredClone(minimum),
				identity: `${identity}/invariant:minimum`,
				postgresName: `qp_ck_messages_${scenario.kind}_bound_minimum`,
				expression: {
					kind: "compare",
					left: { kind: "field", field: identity },
					operator: "greaterThanOrEqual",
					right: { kind: "literal", value: scenario.before },
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
		}
		const targetMessages = target.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:messages",
		);
		const targetField = targetMessages.fields.find(
			(field: { identity: string }) =>
				field.identity === `collection:messages/field:${scenario.kind}Bound`,
		);
		const targetConstraint = targetMessages.constraints.find(
			(constraint: { identity: string }) =>
				constraint.identity ===
				`collection:messages/field:${scenario.kind}Bound/invariant:minimum`,
		);
		targetField.type.minimum = scenario.after;
		targetConstraint.expression.right.value = scenario.after;

		const result = createMigrationPlan({
			baseSchema: base,
			targetSchema: target,
			baseMigration: "000001_create-collaboration",
			slug: `bound-${index}`,
		});
		expect(result.status).toBe("planned");
		if (result.status !== "planned") throw new Error(`bound-${index}`);
		expect(result.plan.steps.some((step) => step.kind === "alterField")).toBe(
			false,
		);
		expect(result.plan.steps.map((step) => step.classification)).toEqual([
			scenario.expected,
			scenario.expected,
		]);
		expect(result.plan.classification).toBe(scenario.expected);
	}
});

test("classifies numeric precision and scale migrations", async () => {
	const schema = await collaborationSchema();
	const cases = [
		{ name: "increase-precision", precision: 12, scale: 2, expected: "safe" },
		{
			name: "decrease-precision",
			precision: 8,
			scale: 2,
			expected: "destructive",
		},
		{
			name: "change-scale",
			precision: 10,
			scale: 3,
			expected: "destructive",
		},
	] as const;

	for (const scenario of cases) {
		const base = structuredClone(schema);
		const target = structuredClone(schema);
		for (const projection of [base, target]) {
			const messages = projection.collections.find(
				(collection: { identity: string }) =>
					collection.identity === "collection:messages",
			);
			messages.fields.push({
				collation: null,
				default: null,
				identity: "collection:messages/field:amount",
				nullable: true,
				path: ["amount"],
				postgresName: "amount",
				type: { kind: "numeric", precision: 10, scale: 2 },
			});
			messages.fields.sort(
				(left: { identity: string }, right: { identity: string }) =>
					left.identity.localeCompare(right.identity),
			);
		}
		const targetAmount = target.collections
			.find(
				(collection: { identity: string }) =>
					collection.identity === "collection:messages",
			)
			.fields.find(
				(field: { identity: string }) =>
					field.identity === "collection:messages/field:amount",
			);
		targetAmount.type = {
			kind: "numeric",
			precision: scenario.precision,
			scale: scenario.scale,
		};

		const result = createMigrationPlan({
			baseSchema: base,
			targetSchema: target,
			baseMigration: "000001_create-collaboration",
			slug: scenario.name,
		});
		expect(result.status, scenario.name).toBe("planned");
		if (result.status !== "planned") throw new Error(scenario.name);
		expect(result.plan.steps).toContainEqual(
			expect.objectContaining({
				kind: "alterField",
				classification: scenario.expected,
			}),
		);
		expect(result.plan.classification, scenario.name).toBe(scenario.expected);
	}
});

test("orders replacement dependencies transitively with unrelated steps", async () => {
	const base = await collaborationSchema();
	const target = structuredClone(base);
	const messages = target.collections.find(
		(collection: { identity: string }) =>
			collection.identity === "collection:messages",
	);
	const minimum = messages.constraints.find(
		(constraint: { identity: string }) =>
			constraint.identity ===
			"collection:messages/field:body/invariant:minLength",
	);
	minimum.expression.right.value = 2;
	const existingIndex = messages.indexes[0];
	messages.indexes.push({
		...structuredClone(existingIndex),
		identity: "collection:messages/index:byAuditIdAgain",
		postgresName: "qp_ix_messages_by_audit_id_again",
	});
	messages.indexes.sort(
		(left: { identity: string }, right: { identity: string }) =>
			left.identity.localeCompare(right.identity),
	);

	const result = createMigrationPlan({
		baseMigration: "000001_create-collaboration",
		baseSchema: base,
		slug: "replace-check-and-add-index",
		targetSchema: target,
	});

	expect(result.status).toBe("planned");
	if (result.status !== "planned") throw new Error("plan disappeared");
	expect(result.plan.steps.map((step) => step.kind)).toEqual([
		"addIndex",
		"dropConstraint",
		"addConstraint",
	]);
});
