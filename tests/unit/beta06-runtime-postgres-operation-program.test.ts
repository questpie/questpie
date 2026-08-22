import { expect, test } from "bun:test";

import { runtimePostgresProgramFixture } from "../support/beta06-runtime-postgres-program";

const compilation = runtimePostgresProgramFixture();

test("links compiler-owned PostgreSQL get/create plans to Collection Operations", async () => {
	const { artifact, operations } = await compilation;
	const { linkPostgresCollectionOperationPlans } =
		await import("../../packages/runtime/src/mutation/postgres-program");
	expect(artifact.digest).toMatch(/^[a-f0-9]{64}$/);
	const linked = linkPostgresCollectionOperationPlans({
		artifact,
		operations,
		expectedDigest: artifact.digest,
	});

	expect(linked.plans.map(({ identity }) => identity)).toEqual([
		"mutation:messageEvents.create",
		"mutation:messages.create",
		"query:channels.get",
		"query:spaces.get",
	]);
	const create = linked.byIdentity.get("mutation:messages.create");
	if (create?.member !== "create") throw new Error("missing create plan");
	expect(create.operation.normalizerProgram).toEqual(create.normalizerProgram);
	expect(create.operation.serverValueProgram).toEqual(
		create.serverValueProgram,
	);
	expect(create.candidatePolicy.freshAfterRowLockWait).toBe(true);
	expect(create.limits).toEqual({
		rows: 100,
		durationMilliseconds: 5_000,
	});

	const get = linked.byIdentity.get("query:channels.get");
	if (get?.member !== "get") throw new Error("missing get plan");
	expect(get.lifecycle.slice(0, 2)).toEqual([
		"keyedRowLock",
		"freshPolicyRead",
	]);
	expect(get.lock.sql).toContain("FOR UPDATE");
	expect(get.read.sql).not.toContain("FOR UPDATE");
	expect(get.lock.statement.text).toBe(get.lock.sql);
	expect(get.read.statement.text).toBe(get.read.sql);
	expect(Object.isFrozen(get.lock.statement)).toBe(true);
	expect(
		linked.plans.every((plan) =>
			plan.member === "get"
				? Object.isFrozen(plan.lock.statement) &&
					Object.isFrozen(plan.read.statement)
				: plan.fieldAuthority.checks.every(({ statement }) =>
						Object.isFrozen(statement),
					) && Object.isFrozen(plan.write.statement),
		),
	).toBe(true);
	expect(linked.byIdentity.get(get.identity)).toBe(get);
	expect(get.lock.statement.name).toMatch(
		/^mutation\.collection\.[a-f0-9]{48}$/,
	);
	expect(get.lock.statement.name).not.toContain(":");
	expect(
		get.lock.statement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [[true]],
		}),
	).toEqual([{}]);
	expect(() =>
		get.lock.statement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [[false]],
		}),
	).toThrow("boolean result is invalid");

	const row: unknown[] = [];
	for (const item of create.write.result) {
		const value =
			item.codec.kind === "uuid"
				? "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0"
				: item.codec.kind === "boolean"
					? true
					: item.codec.kind === "integer"
						? 1
						: item.codec.kind === "timestamp"
							? new Date("2026-08-22T00:00:00.000Z")
							: item.codec.kind === "date"
								? "2026-08-22"
								: item.codec.kind === "bigint"
									? "1"
									: item.codec.kind === "numeric"
										? item.codec.scale === 0
											? "1"
											: `1.${"0".repeat(item.codec.scale)}`
										: "value";
		row.push(value);
		if (item.guardColumn !== undefined) row.push(true);
	}
	const decoded = create.write.statement.decode({
		command: "SELECT",
		rowCount: 1,
		rows: [row],
	});
	expect(decoded).toHaveLength(1);
	expect(Object.isFrozen(decoded[0])).toBe(true);
	const invalid = [...row];
	invalid[0] = Symbol("invalid");
	expect(() =>
		create.write.statement.decode({
			command: "SELECT",
			rowCount: 1,
			rows: [invalid],
		}),
	).toThrow("invalid relational scalar");

	const guardedIndex = create.write.result.findIndex(
		(item) => item.guardColumn !== undefined,
	);
	if (guardedIndex < 0) throw new Error("missing guarded result");
	const guardedOffset = create.write.result
		.slice(0, guardedIndex)
		.reduce(
			(width, item) => width + (item.guardColumn === undefined ? 1 : 2),
			0,
		);
	const invalidGuard = [...row];
	invalidGuard[guardedOffset + 1] = "true";
	const disclosedHiddenValue = [...row];
	disclosedHiddenValue[guardedOffset + 1] = false;
	const nonnullableIndex = create.write.result.findIndex(
		(item) => !item.nullable,
	);
	if (nonnullableIndex < 0) throw new Error("missing nonnullable result");
	const nonnullableOffset = create.write.result
		.slice(0, nonnullableIndex)
		.reduce(
			(width, item) => width + (item.guardColumn === undefined ? 1 : 2),
			0,
		);
	const invalidNull = [...row];
	invalidNull[nonnullableOffset] = null;
	for (const [output, message] of [
		[
			{ command: "UPDATE", rowCount: 1, rows: [row] },
			"result shape is invalid",
		],
		[
			{ command: "SELECT", rowCount: 0, rows: [row] },
			"result shape is invalid",
		],
		[
			{ command: "SELECT", rowCount: 1, rows: [[...row, null]] },
			"result width is invalid",
		],
		[
			{ command: "SELECT", rowCount: 1, rows: [invalidGuard] },
			"guard is invalid",
		],
		[
			{ command: "SELECT", rowCount: 1, rows: [disclosedHiddenValue] },
			"hidden result is invalid",
		],
		[
			{ command: "SELECT", rowCount: 1, rows: [invalidNull] },
			"null result is invalid",
		],
	] as const) {
		expect(() => create.write.statement.decode(output)).toThrow(message);
	}
});
