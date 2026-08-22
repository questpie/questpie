import { expect, test } from "bun:test";

import { runtimeArtifactDigest } from "../../packages/runtime/src/application/artifact-protocol";
import { linkPostgresCollectionOperationPlans as linkPlans } from "../../packages/runtime/src/mutation/postgres-program";
import type { LinkedCollectionMutationProgramsV1 } from "../../packages/runtime/src/mutation/program";
import { runtimePostgresProgramFixture } from "../support/beta06-runtime-postgres-program";

type MutableRecord = Record<string, unknown>;

const compilation = runtimePostgresProgramFixture();

function record(value: unknown): MutableRecord {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("test fixture member is not an object");
	return value as MutableRecord;
}

function artifact(value: unknown) {
	const result = structuredClone(value) as MutableRecord;
	if (!Array.isArray(result.plans)) throw new TypeError("fixture has no plans");
	return result as MutableRecord & { plans: MutableRecord[] };
}

function plan(value: ReturnType<typeof artifact>, identity: string) {
	const result = value.plans.find(
		(candidate) => candidate.identity === identity,
	);
	if (!result) throw new TypeError(`fixture has no ${identity}`);
	return result;
}

function parameters(value: MutableRecord, member: string): MutableRecord[] {
	const statement = record(value[member]);
	if (!Array.isArray(statement.parameters))
		throw new TypeError(`fixture ${member} has no parameters`);
	return statement.parameters.map(record);
}

function firstPlaceholder(value: MutableRecord, member: string) {
	const candidate = parameters(value, member)[0];
	if (!candidate) throw new TypeError(`fixture ${member} has no parameters`);
	return {
		position: Number(candidate.position),
		postgresType: String(candidate.postgresType),
	};
}

function linkPostgresCollectionOperationPlans(
	input: Readonly<{
		artifact: MutableRecord & { plans: MutableRecord[] };
		operations: LinkedCollectionMutationProgramsV1;
	}>,
) {
	const unsigned = {
		format: input.artifact.format,
		version: input.artifact.version,
		plans: input.artifact.plans,
	};
	const digest = runtimeArtifactDigest(
		"questpie-postgres-collection-operation-plans-v1",
		unsigned,
	);
	input.artifact.digest = digest;
	return linkPlans({ ...input, expectedDigest: digest });
}

test("rejects extra executable-plan keys", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	plan(hostile, "mutation:messages.create").runtimePlanner = true;
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("has invalid keys");
});

test("rejects embedded write-program digest drift", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const normalizer = record(
		plan(hostile, "mutation:messages.create").normalizerProgram,
	);
	const steps = normalizer.steps;
	if (!Array.isArray(steps))
		throw new TypeError("fixture has no normalizer steps");
	record(record(steps[0]).expression).kind = "trimIfPresent";
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("executable write-program digest link is invalid");
});

test("rejects an executable-plan identity redirect", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	plan(hostile, "mutation:messages.create").identity =
		"mutation:messages.redirected";
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow(/unique and sorted|no executable Collection Operation/);
});

test("rejects a missing executable plan", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	hostile.plans = hostile.plans.filter(
		(candidate) => candidate.identity !== "query:spaces.get",
	);
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("missing an executable Collection Operation plan");
});

test("rejects a conditional output whose guard link is missing", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const output = record(
		plan(hostile, "mutation:messages.create").outputAuthority,
	);
	if (!Array.isArray(output.selectedPaths))
		throw new TypeError("fixture has no selected output paths");
	const conditional = output.selectedPaths
		.map(record)
		.find((item) => Boolean(item.conditional));
	if (!conditional) throw new TypeError("fixture has no conditional output");
	delete conditional.guardColumn;
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("has invalid keys");
});

test("rejects collapsing keyed lock and fresh Policy read", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const get = plan(hostile, "query:channels.get");
	record(get.read).sql = record(get.lock).sql;
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("lock and fresh Policy read were collapsed");
});

test.each([
	{ codec: { kind: "integer", minimum: -2_147_483_649, maximum: null } },
	{ codec: { kind: "bigint", minimum: "not-a-bigint", maximum: null } },
	{ codec: { kind: "numeric", precision: 1_001, scale: 0 } },
])(
	"rejects a scalar descriptor outside the PostgreSQL contract",
	async ({ codec }) => {
		const fixture = await compilation;
		const hostile = artifact(fixture.artifact);
		const create = plan(hostile, "mutation:messages.create");
		const candidate = record(create.candidate);
		if (!Array.isArray(candidate.fields))
			throw new TypeError("fixture candidate has no fields");
		record(candidate.fields[0]).codec = codec;
		expect(() =>
			linkPostgresCollectionOperationPlans({
				artifact: hostile,
				operations: fixture.operations,
			}),
		).toThrow(/bounds are invalid|bigint is invalid/);
	},
);

test("rejects an execution fact whose source and path do not form a closed fact", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const write = parameters(plan(hostile, "mutation:messages.create"), "write");
	const fact = write.find((parameter) => parameter.kind === "executionFact");
	if (!fact) throw new TypeError("fixture write has no execution fact");
	fact.path = ["unknown"];
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("execution source is invalid");
});

test("rejects a literal whose value disagrees with its codec", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const write = parameters(plan(hostile, "mutation:messages.create"), "write");
	const literal = write.find(
		(parameter) => parameter.kind === "literal" && parameter.codec === "uuid",
	);
	if (!literal) throw new TypeError("fixture write has no UUID literal");
	literal.value = "not-a-uuid";
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("literal is invalid");
});

test("rejects a literal whose PostgreSQL type disagrees with its codec", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const create = plan(hostile, "mutation:messages.create");
	const write = record(create.write);
	const literal = parameters(create, "write").find(
		(parameter) => parameter.kind === "literal" && parameter.codec === "uuid",
	);
	if (!literal) throw new TypeError("fixture write has no UUID literal");
	const position = Number(literal.position);
	write.sql = String(write.sql).replaceAll(
		`$${position}::uuid`,
		`$${position}::text`,
	);
	literal.postgresType = "text";
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("codec or PostgreSQL type is invalid");
});

test("rejects a noncanonical PostgreSQL placeholder", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const get = plan(hostile, "query:channels.get");
	const lock = record(get.lock);
	const { position, postgresType } = firstPlaceholder(get, "lock");
	lock.sql = String(lock.sql).replace(
		`$${position}::${postgresType}`,
		`$0${position}::${postgresType}`,
	);
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("SQL placeholder is invalid");
});

test("rejects a repeated PostgreSQL placeholder with a different cast", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const get = plan(hostile, "query:channels.get");
	const lock = record(get.lock);
	const { position, postgresType } = firstPlaceholder(get, "lock");
	const wrongType = postgresType === "text" ? "uuid" : "text";
	const placeholder = `$${position}::${postgresType}`;
	lock.sql = String(lock.sql).replace(
		placeholder,
		`($${position}::${wrongType} IS NOT NULL AND ${placeholder} IS NOT NULL)`,
	);
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("SQL placeholder cast is invalid");
});

test("rejects a PostgreSQL cast that only prefixes the declared type", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const get = plan(hostile, "query:channels.get");
	const lock = record(get.lock);
	const { position, postgresType } = firstPlaceholder(get, "lock");
	lock.sql = String(lock.sql).replace(
		`$${position}::${postgresType}`,
		`$${position}::${postgresType}[]`,
	);
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("SQL placeholder cast is invalid");
});

test("does not count a placeholder inside a PostgreSQL string literal", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	const get = plan(hostile, "query:channels.get");
	const lock = record(get.lock);
	const { position, postgresType } = firstPlaceholder(get, "lock");
	const placeholder = `$${position}::${postgresType}`;
	lock.sql = String(lock.sql)
		.replace(placeholder, `NULL::${postgresType}`)
		.replace(" LIMIT 1", ` AND '${placeholder}' IS NOT NULL LIMIT 1`);
	expect(() =>
		linkPostgresCollectionOperationPlans({
			artifact: hostile,
			operations: fixture.operations,
		}),
	).toThrow("SQL placeholders do not match its parameters");
});

test("checks the independent digest before decoding a hostile plan", async () => {
	const fixture = await compilation;
	const hostile = artifact(fixture.artifact);
	plan(hostile, "mutation:messages.create").runtimePlanner = true;
	expect(() =>
		linkPlans({
			artifact: hostile,
			operations: fixture.operations,
			expectedDigest: String(fixture.artifact.digest),
		}),
	).toThrow("artifact digest is invalid");
});
