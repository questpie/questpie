import { expect } from "bun:test";

import {
	definePostgresStatement,
	type PostgresTransactionRunner,
} from "../../../../packages/runtime/src/postgres/contract";
import { eventually } from "../../../../packages/testkit/src";

const identity = definePostgresStatement<
	void,
	{ pid: number; xid: string },
	"SELECT"
>({
	name: "test.owner-deadline.identity",
	operation: "SELECT",
	text: "SELECT pg_backend_pid(), pg_current_xact_id()::text",
	parameterCount: 0,
	parameters: () => [],
	decode: (result) => ({
		pid: result.rows[0]![0] as number,
		xid: result.rows[0]![1] as string,
	}),
});
const waitForLock = definePostgresStatement<number, void, "SELECT">({
	name: "test.owner-deadline.lock",
	operation: "SELECT",
	text: "SELECT pg_advisory_xact_lock($1)",
	parameterCount: 1,
	parameters: (key) => [key],
	decode: () => undefined,
});

/** Block the real owner transaction after its selected statement, without caller cancellation. */
export async function provePostgresOwnerDeadline(
	input: Readonly<{
		database: PostgresTransactionRunner;
		connectionUrl: string;
		statementName: string;
		milliseconds: 5000 | 10000;
		use(database: PostgresTransactionRunner): Promise<unknown>;
	}>,
) {
	// Initialize pg only after a caller's generated application has compiled.
	const { Client } = await import("pg");
	const blocker = new Client({ connectionString: input.connectionUrl });
	await blocker.connect();
	const key = crypto.getRandomValues(new Uint32Array(1))[0]! % 2_147_483_647;
	let pending: Promise<{ value: unknown } | { error: unknown }> | undefined;
	let guard: ReturnType<typeof setTimeout> | undefined;
	let reached: { pid: number; xid: string } | undefined;
	try {
		await blocker.query("SELECT pg_advisory_lock($1)", [key]);
		const database: PostgresTransactionRunner = {
			transaction: (request) =>
				input.database.transaction({
					...request,
					use: (transaction) =>
						request.use({
							...transaction,
							execute: async (statement, parameters) => {
								const result = await transaction.execute(statement, parameters);
								if (statement.name === input.statementName) {
									reached = await transaction.execute(identity, undefined);
									await transaction.execute(waitForLock, key);
								}
								return result;
							},
						}),
				}),
		};
		const started = performance.now();
		pending = input.use(database).then(
			(value) => ({ value }),
			(error: unknown) => ({ error }),
		);
		const bounded = Promise.race([
			pending,
			new Promise<never>((_resolve, reject) => {
				guard = setTimeout(
					() =>
						reject(
							new Error("owner deadline did not expire before the test guard"),
						),
					input.milliseconds + 2500,
				);
			}),
		]);
		// Own guard rejection even if observing the waiter fails first.
		void bounded.catch(() => undefined);
		await eventually(
			async () => {
				if (!reached) return false;
				const result = await blocker.query(
					"SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND backend_xid::text = $2 AND wait_event_type = 'Lock') AS waiting",
					[reached.pid, reached.xid],
				);
				return result.rows[0].waiting as boolean;
			},
			{
				description: "owner transaction waits after its real statement",
				timeoutMilliseconds: 2000,
				accept: (waiting) => waiting,
			},
		);
		const outcome = await bounded;
		expect(outcome).toMatchObject({
			error: {
				code: "cancelled",
				phase: "statement",
				cause: { name: "TimeoutError" },
			},
		});
		expect(performance.now() - started).toBeGreaterThanOrEqual(
			input.milliseconds - 250,
		);
		const result = await blocker.query(
			"SELECT count(*)::int AS active FROM pg_stat_activity WHERE pid = $1 AND backend_xid::text = $2",
			[reached!.pid, reached!.xid],
		);
		expect(result.rows[0].active).toBe(0);
	} finally {
		if (guard) clearTimeout(guard);
		// The guard is failure only. Release for cleanup, never to make a missing deadline pass.
		await blocker.query("SELECT pg_advisory_unlock($1)", [key]);
		await pending;
		await blocker.end();
	}
}
