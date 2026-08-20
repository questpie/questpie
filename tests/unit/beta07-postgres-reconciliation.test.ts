import { expect, test } from "bun:test";

import { reconcilePostgresChangeLedger } from "../../packages/runtime/src/live-query";

interface Query {
	cancel(): Query;
	execute(): Query;
}

function postgresFixture(
	options: Readonly<{
		failApply?: boolean;
		serializationFailures?: number;
	}> = {},
) {
	const statements: string[] = [];
	let released = 0;
	let serializationFailures = options.serializationFailures ?? 0;
	const session = {
		unsafe(statement: string): Query {
			statements.push(statement);
			if (
				statement.startsWith(
					"INSERT INTO questpie_internal.reconciliation_consumers",
				) &&
				serializationFailures > 0
			) {
				serializationFailures -= 1;
				const query = Promise.reject(
					Object.assign(new Error("concurrent reconciliation"), {
						errno: "40001",
					}),
				) as Promise<readonly Record<string, unknown>[]> & Query;
				query.cancel = () => query;
				query.execute = () => query;
				return query;
			}
			const rows = statement.startsWith("SELECT xid_horizon")
				? [{ priorHorizon: "100", nextHorizon: "102" }]
				: statement.startsWith("SELECT fact_identity")
					? [
							{
								factIdentity: "00000000-0000-4000-a000-000000000007",
								factId: "7",
								transactionId: "101",
								collection: "collection:messages",
								kind: "insert",
								oldKey: null,
								newKey: { id: "message-new" },
								conservative: false,
								capturedAt: new Date("2026-08-16T00:00:00.000Z"),
							},
						]
					: [];
			const query = Promise.resolve(rows) as Promise<
				readonly Record<string, unknown>[]
			> &
				Query;
			query.cancel = () => query;
			query.execute = () => query;
			return query;
		},
		release() {
			released += 1;
		},
		close: async () => undefined,
	};
	return {
		sql: { reserve: async () => session },
		statements,
		released: () => released,
		failApply: options.failApply ?? false,
	};
}

test("advances an exclusive xid8 horizon only after applying visible facts", async () => {
	const fixture = postgresFixture();
	const applied: string[] = [];
	const result = await reconcilePostgresChangeLedger({
		sql: fixture.sql as never,
		application: "application:collaboration",
		consumer: "runtime:primary",
		apply: (facts) => {
			applied.push(...facts.map(({ factIdentity }) => factIdentity));
		},
	});

	expect(result).toEqual({
		priorHorizon: "100",
		nextHorizon: "102",
		facts: [
			expect.objectContaining({
				factIdentity: "00000000-0000-4000-a000-000000000007",
				transactionId: "101",
				collection: "collection:messages",
				kind: "insert",
			}),
		],
	});
	expect(applied).toEqual(["00000000-0000-4000-a000-000000000007"]);
	expect(
		fixture.statements.map((statement) => statement.split("\n")[0]),
	).toEqual([
		"BEGIN ISOLATION LEVEL REPEATABLE READ",
		"INSERT INTO questpie_internal.reconciliation_consumers",
		'SELECT xid_horizon::text AS "priorHorizon",',
		'SELECT fact_identity::text AS "factIdentity",',
		"INSERT INTO questpie_internal.processed_change_facts",
		"UPDATE questpie_internal.reconciliation_consumers",
		"COMMIT",
	]);
	expect(fixture.released()).toBe(1);
});

test("rolls back without processing or advancing when recomputation fails", async () => {
	const fixture = postgresFixture({ failApply: true });
	await expect(
		reconcilePostgresChangeLedger({
			sql: fixture.sql as never,
			application: "application:collaboration",
			consumer: "runtime:primary",
			apply: () => {
				throw new Error("recompute failed");
			},
		}),
	).rejects.toThrow("recompute failed");

	expect(fixture.statements).not.toContainEqual(
		expect.stringContaining(
			"INSERT INTO questpie_internal.processed_change_facts",
		),
	);
	expect(fixture.statements).not.toContainEqual(
		expect.stringContaining(
			"UPDATE questpie_internal.reconciliation_consumers",
		),
	);
	expect(fixture.statements.at(-1)).toBe("ROLLBACK");
	expect(fixture.released()).toBe(1);
});

test("retries a concurrent repeatable-read reconciliation from a fresh transaction", async () => {
	const fixture = postgresFixture({ serializationFailures: 1 });
	let applyCount = 0;

	await expect(
		reconcilePostgresChangeLedger({
			sql: fixture.sql as never,
			application: "application:collaboration",
			consumer: "runtime:primary",
			apply: () => {
				applyCount += 1;
			},
		}),
	).resolves.toEqual(
		expect.objectContaining({ priorHorizon: "100", nextHorizon: "102" }),
	);

	expect(
		fixture.statements.filter(
			(statement) => statement === "BEGIN ISOLATION LEVEL REPEATABLE READ",
		),
	).toHaveLength(2);
	expect(fixture.statements).toContain("ROLLBACK");
	expect(fixture.released()).toBe(2);
	expect(applyCount).toBe(1);
});
