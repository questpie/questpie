import { expect, test } from "bun:test";

import { linkPostgresCollectionOperationPlans } from "../../packages/runtime/src/mutation";
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
