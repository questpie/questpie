import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { projectPostgresContextBootstrapPlans } from "../../packages/compiler/src/relational";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compilationPromise = compileApplication({ applicationRoot: fixtureRoot });

type MutablePlan = {
	digest: string;
	collection: string;
	sql: string;
	fields: Array<{ key: string; codec: unknown }>;
	[key: string]: unknown;
};

type MutableArtifact = {
	digest: string;
	plans: MutablePlan[];
	[key: string]: unknown;
};

async function rehashPlan(artifact: MutableArtifact, plan: MutablePlan) {
	const { runtimeArtifactDigest } =
		await import("../../packages/runtime/src/application/artifact-protocol");
	const { digest: _planDigest, ...unsignedPlan } = plan;
	plan.digest = runtimeArtifactDigest(
		"questpie-postgres-context-bootstrap-plan-v1",
		unsignedPlan,
	);
	const { digest: _artifactDigest, ...unsignedArtifact } = artifact;
	artifact.digest = runtimeArtifactDigest(
		"questpie-postgres-context-bootstrap-plans-v1",
		unsignedArtifact,
	);
}

async function rehashArtifact(artifact: MutableArtifact) {
	const { runtimeArtifactDigest } =
		await import("../../packages/runtime/src/application/artifact-protocol");
	const { digest: _artifactDigest, ...unsignedArtifact } = artifact;
	artifact.digest = runtimeArtifactDigest(
		"questpie-postgres-context-bootstrap-plans-v1",
		unsignedArtifact,
	);
}

test("compiles and links static ContextBootstrap statements", async () => {
	const compilation = await compilationPromise;
	const {
		executeLinkedPostgresContextBootstrap,
		linkPostgresContextBootstrapPlans,
	} =
		await import("../../packages/runtime/src/relational/context-bootstrap-database");
	const artifact =
		compilation.generatedFiles["postgres-context-bootstrap-plans.json"];
	expect(artifact).toBeDefined();
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"]!,
	);
	const envelope = JSON.parse(artifact!);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	);
	expect(runtimeBuild.postgresContextBootstrapPlansDigest).toBe(
		envelope.digest,
	);
	const linked = linkPostgresContextBootstrapPlans({
		artifact: artifact!,
		schemaProjection: schema,
		expectedDigest: runtimeBuild.postgresContextBootstrapPlansDigest,
	});
	expect(linked.plans.map(({ plan }) => plan.collection)).toEqual(
		schema.collections
			.map((collection: { identity: string }) => collection.identity)
			.toSorted(),
	);
	const membership = linked.get("collection:memberships");
	expect(membership).toBeDefined();
	expect(membership!.plan.sql).toContain("CASE");
	expect(membership!.plan.sql).toContain('AS "qp_selected_0"');

	const events: string[] = [];
	const database = {
		transaction: async ({
			use,
		}: {
			use(transaction: unknown): Promise<unknown>;
		}) => {
			events.push("begin");
			const output = await use({
				execute: async (
					statement: {
						parameters(value: unknown): unknown;
						decode(value: unknown): unknown;
					},
					value: unknown,
				) => {
					statement.parameters(value);
					events.push("execute");
					const row = membership!.plan.fields.flatMap((field) =>
						field.key === "role" ? [true, "admin"] : [false, null],
					);
					const decoded = statement.decode({
						command: "SELECT",
						rowCount: 1,
						rows: [row],
					});
					events.push("decode");
					return decoded;
				},
			});
			events.push("commit");
			return output;
		},
	};
	const result = await executeLinkedPostgresContextBootstrap(
		database as never,
		membership!,
		{
			key: {
				companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
				principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
				scopeKey: "company",
			},
			select: { role: true },
		},
	);
	expect(result).toEqual({ role: "admin" });
	expect(Object.isFrozen(result)).toBe(true);
	expect(events).toEqual(["begin", "execute", "decode", "commit"]);
});

test("rejects codec and SQL identity tampering", async () => {
	const compilation = await compilationPromise;
	const { linkPostgresContextBootstrapPlans } =
		await import("../../packages/runtime/src/relational/context-bootstrap-database");
	const original = JSON.parse(
		compilation.generatedFiles["postgres-context-bootstrap-plans.json"]!,
	) as MutableArtifact;
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"]!,
	);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	);

	const replaced = structuredClone(original);
	const replacedMembership = replaced.plans.find(
		(plan) => plan.collection === "collection:memberships",
	)!;
	replacedMembership.sql = replacedMembership.sql.replace(
		"LIMIT 1",
		"LIMIT 1 ",
	);
	await rehashPlan(replaced, replacedMembership);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(replaced),
			schemaProjection: schema,
			expectedDigest: runtimeBuild.postgresContextBootstrapPlansDigest,
		}),
	).toThrow();

	const codecAttack = structuredClone(original);
	const codecMembership = codecAttack.plans.find(
		(plan) => plan.collection === "collection:memberships",
	)!;
	codecMembership.fields.find((field) => field.key === "role")!.codec = {
		kind: "uuid",
	};
	await rehashPlan(codecAttack, codecMembership);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(codecAttack),
			schemaProjection: schema,
			expectedDigest: codecAttack.digest,
		}),
	).toThrow("Field does not match Schema");

	const incomplete = structuredClone(original);
	incomplete.plans.pop();
	await rehashArtifact(incomplete);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(incomplete),
			schemaProjection: schema,
			expectedDigest: incomplete.digest,
		}),
	).toThrow("plans do not match Collections");

	const duplicate = structuredClone(original);
	duplicate.plans[1] = structuredClone(duplicate.plans[0]!);
	await rehashArtifact(duplicate);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(duplicate),
			schemaProjection: schema,
			expectedDigest: duplicate.digest,
		}),
	).toThrow("plans do not match Collections");

	const reordered = structuredClone(original);
	reordered.plans.reverse();
	await rehashArtifact(reordered);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(reordered),
			schemaProjection: schema,
			expectedDigest: reordered.digest,
		}),
	).toThrow("plans do not match Collections");

	const surplus = structuredClone(original);
	surplus.plans.push(structuredClone(surplus.plans.at(-1)!));
	await rehashArtifact(surplus);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(surplus),
			schemaProjection: schema,
			expectedDigest: surplus.digest,
		}),
	).toThrow("plans do not match Collections");

	const replacementUnknown = structuredClone(original);
	const unknown = replacementUnknown.plans.at(-1)!;
	unknown.collection = "collection:zzzz-unknown";
	await rehashPlan(replacementUnknown, unknown);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(replacementUnknown),
			schemaProjection: schema,
			expectedDigest: replacementUnknown.digest,
		}),
	).toThrow("unknown ContextBootstrap Collection");
});

test("derives and enforces the exact eligible Collection subset", async () => {
	const compilation = await compilationPromise;
	const { linkPostgresContextBootstrapPlans } =
		await import("../../packages/runtime/src/relational/context-bootstrap-database");
	const original = JSON.parse(
		compilation.generatedFiles["postgres-context-bootstrap-plans.json"]!,
	) as MutableArtifact;
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"]!,
	);
	const source = schema.collections[0];
	const makeField = (
		identity: string,
		options: Readonly<{
			nullable?: boolean;
			path?: readonly string[];
			type?: unknown;
		}> = {},
	) => ({
		...source.fields[0],
		identity: `field:${identity}`,
		path: options.path ?? ["id"],
		postgresName: identity.replaceAll("-", "_"),
		nullable: options.nullable ?? false,
		type: options.type ?? source.fields[0].type,
	});
	const makeCollection = (
		identity: string,
		fields: readonly unknown[],
		constraints: readonly unknown[],
	) => ({
		...source,
		identity: `collection:${identity}`,
		name: identity,
		postgresName: identity.replaceAll("-", "_"),
		fields,
		constraints,
	});
	const primary = (identity: string) => ({
		kind: "primaryKey",
		fields: [`field:${identity}`],
	});
	const supportedPrimary = makeField("zzzy-supported-id");
	const supportedName = makeField("zzzy-supported-name", {
		path: ["name"],
		type: {
			kind: "text",
			minLength: null,
			maxLength: null,
			collation: "questpie.binary",
		},
	});
	const supported = makeCollection(
		"zzzy-supported",
		[
			supportedPrimary,
			supportedName,
			makeField("zzzy-nested-nonkey", {
				path: ["profile", "secret"],
			}),
			makeField("zzzy-object-nonkey", {
				type: { kind: "object", properties: {} },
			}),
		],
		[primary("zzzy-supported-id")],
	);
	const nestedPrimary = makeField("zzzz-nested-primary", {
		path: ["address", "city"],
	});
	const objectPrimary = makeField("zzzz-object-primary", {
		type: { kind: "object", properties: {} },
	});
	const bigintPrimary = makeField("zzzz-bigint-primary", {
		type: { kind: "bigint", minimum: null, maximum: null },
	});
	const nullablePrimary = makeField("zzzz-nullable-primary", {
		nullable: true,
	});
	const ineligible = [
		makeCollection(
			"zzzz-nested-primary",
			[nestedPrimary],
			[primary("zzzz-nested-primary")],
		),
		makeCollection(
			"zzzz-object-primary",
			[objectPrimary],
			[primary("zzzz-object-primary")],
		),
		makeCollection(
			"zzzz-bigint-primary",
			[bigintPrimary],
			[primary("zzzz-bigint-primary")],
		),
		makeCollection(
			"zzzz-nullable-primary",
			[nullablePrimary],
			[primary("zzzz-nullable-primary")],
		),
		makeCollection("zzzz-absent-primary", [makeField("zzzz-absent-id")], []),
		makeCollection(
			"zzzz-empty-primary",
			[],
			[{ kind: "primaryKey", fields: [] }],
		),
		makeCollection(
			"zzzz-multiple-primary",
			[makeField("zzzz-multiple-id")],
			[primary("zzzz-multiple-id"), primary("zzzz-multiple-id")],
		),
	];
	const augmentedSchema = {
		...schema,
		collections: [...schema.collections, supported, ...ineligible],
	};
	const projected = projectPostgresContextBootstrapPlans(augmentedSchema);
	const eligible = [
		...original.plans.map((plan) => plan.collection),
		supported.identity,
	].toSorted();
	expect(projected.plans.map((plan) => plan.collection)).toEqual(eligible);
	expect(
		projected.plans
			.find((plan) => plan.collection === supported.identity)!
			.fields.map((field) => field.key),
	).toEqual(["id", "name"]);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(projected),
			schemaProjection: augmentedSchema,
			expectedDigest: projected.digest,
		}),
	).not.toThrow();

	const missing = structuredClone(projected) as MutableArtifact;
	missing.plans = missing.plans.filter(
		(plan) => plan.collection !== supported.identity,
	);
	await rehashArtifact(missing);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(missing),
			schemaProjection: augmentedSchema,
			expectedDigest: missing.digest,
		}),
	).toThrow("plans do not match Collections");

	const replacement = structuredClone(projected) as MutableArtifact;
	const replacementPlan = replacement.plans.find(
		(plan) => plan.collection === supported.identity,
	)!;
	replacementPlan.collection = "collection:zzzz-nested-primary";
	await rehashPlan(replacement, replacementPlan);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(replacement),
			schemaProjection: augmentedSchema,
			expectedDigest: replacement.digest,
		}),
	).toThrow("unknown ContextBootstrap Collection");

	const surplus = structuredClone(projected) as MutableArtifact;
	const surplusPlan = structuredClone(surplus.plans.at(-1)!);
	surplusPlan.collection = "collection:zzzz-surplus-ineligible";
	surplus.plans.push(surplusPlan);
	await rehashPlan(surplus, surplusPlan);
	expect(() =>
		linkPostgresContextBootstrapPlans({
			artifact: JSON.stringify(surplus),
			schemaProjection: augmentedSchema,
			expectedDigest: surplus.digest,
		}),
	).toThrow("plans do not match Collections");
});

test("decodes inside the transaction and rolls every invalid result back", async () => {
	const compilation = await compilationPromise;
	const {
		executeLinkedPostgresContextBootstrap,
		linkPostgresContextBootstrapPlans,
	} =
		await import("../../packages/runtime/src/relational/context-bootstrap-database");
	const artifact =
		compilation.generatedFiles["postgres-context-bootstrap-plans.json"]!;
	const envelope = JSON.parse(artifact);
	const linked = linkPostgresContextBootstrapPlans({
		artifact,
		schemaProjection: JSON.parse(
			compilation.generatedFiles["schema-projection.json"]!,
		),
		expectedDigest: envelope.digest,
	});
	const membership = linked.get("collection:memberships")!;
	const lookup = {
		key: {
			companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
			principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			scopeKey: "company",
		},
		select: { companyId: true },
	};
	const baseRow = membership.plan.fields.flatMap(() => [false, null]);
	const invalidResults = [
		{ command: "INSERT", rowCount: 1, rows: [baseRow] },
		{ command: "SELECT", rowCount: null, rows: [baseRow] },
		{ command: "SELECT", rowCount: 2, rows: [baseRow] },
		{ command: "SELECT", rowCount: 2, rows: [baseRow, baseRow] },
		{ command: "SELECT", rowCount: 1, rows: [baseRow.slice(1)] },
		{
			command: "SELECT",
			rowCount: 1,
			rows: [["true", null, ...baseRow.slice(2)]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[false, "disclosed", ...baseRow.slice(2)]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[true, "not-a-uuid", ...baseRow.slice(2)]],
		},
		{
			command: "SELECT",
			rowCount: 1,
			rows: [[true, null, ...baseRow.slice(2)]],
		},
	];
	const databaseFor = (result: unknown, events: string[]) => ({
		transaction: async ({
			use,
		}: {
			use(transaction: unknown): Promise<unknown>;
		}) => {
			events.push("begin");
			try {
				const output = await use({
					execute: async (
						statement: {
							parameters(value: unknown): unknown;
							decode(value: unknown): unknown;
						},
						value: unknown,
					) => {
						statement.parameters(value);
						events.push("execute");
						return statement.decode(result);
					},
				});
				events.push("commit");
				return output;
			} catch (error) {
				events.push("rollback");
				throw error;
			}
		},
	});
	for (const invalid of invalidResults) {
		const events: string[] = [];
		await expect(
			executeLinkedPostgresContextBootstrap(
				databaseFor(invalid, events) as never,
				membership,
				lookup,
			),
		).rejects.toThrow();
		expect(events).toEqual(["begin", "execute", "rollback"]);
	}

	const missEvents: string[] = [];
	const miss = await executeLinkedPostgresContextBootstrap(
		databaseFor(
			{ command: "SELECT", rowCount: 0, rows: [] },
			missEvents,
		) as never,
		membership,
		lookup,
	);
	expect(miss).toBeNull();
	expect(missEvents).toEqual(["begin", "execute", "commit"]);

	const messages = linked.get("collection:messages")!;
	const nullableIndex = messages.plan.fields.findIndex(
		(field) => field.key === "auditedAt",
	);
	const nullableRow = messages.plan.fields.flatMap((_, index) =>
		index === nullableIndex ? [true, null] : [false, null],
	);
	const nullableEvents: string[] = [];
	const selectedNull = await executeLinkedPostgresContextBootstrap(
		databaseFor(
			{ command: "SELECT", rowCount: 1, rows: [nullableRow] },
			nullableEvents,
		) as never,
		messages,
		{
			key: { id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61c1" },
			select: { auditedAt: true },
		},
	);
	expect(selectedNull).toEqual({ auditedAt: null });
	expect(Object.isFrozen(selectedNull)).toBe(true);
	expect(nullableEvents).toEqual(["begin", "execute", "commit"]);
});

test("ratchets compiler projection at 832 Fields and rejects the first target overflow", async () => {
	const compilation = await compilationPromise;
	const schema = JSON.parse(
		compilation.generatedFiles["schema-projection.json"]!,
	);
	const source = schema.collections[0];
	const makeCollection = (count: number) => {
		const fields = Array.from({ length: count }, (_, index) => ({
			...source.fields[0],
			identity: `field:bound-${index}`,
			path: [`bound${index}`],
			postgresName: `bound_${index}`,
			nullable: false,
		}));
		return {
			...source,
			fields,
			constraints: [{ kind: "primaryKey", fields: [fields[0].identity] }],
		};
	};
	const atLimit = { ...schema, collections: [makeCollection(832)] };
	expect(
		projectPostgresContextBootstrapPlans(atLimit).plans[0]!.fields,
	).toHaveLength(832);
	const overLimit = { ...schema, collections: [makeCollection(833)] };
	expect(() => projectPostgresContextBootstrapPlans(overLimit)).toThrow(
		"exceeds PostgreSQL ContextBootstrap statement bounds",
	);
});
