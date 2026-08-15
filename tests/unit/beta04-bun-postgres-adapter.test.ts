import { expect, test } from "bun:test";

import type { SQL } from "bun";

import { executePostgresKeyedOutcome } from "../../packages/runtime/src/relational/postgres";

interface DeferredQuery {
	cancel(): DeferredQuery;
	execute(): DeferredQuery;
	then: Promise<readonly Record<string, unknown>[]>["then"];
}

function fakeSql() {
	const calls: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
	const controlStatements: string[] = [];
	let cancellations = 0;
	let commits = 0;
	let rollbacks = 0;
	let closes = 0;
	let releases = 0;
	let block = false;
	let rejectActive: ((reason?: unknown) => void) | undefined;
	let started: (() => void) | undefined;
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	const transaction = {
		async close() {
			closes += 1;
			rejectActive?.(new Error("connection closed"));
		},
		release() {
			releases += 1;
		},
		unsafe(sql: string, parameters: readonly unknown[] = []): DeferredQuery {
			if (
				sql === "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" ||
				sql === "COMMIT" ||
				sql === "ROLLBACK"
			) {
				controlStatements.push(sql);
				if (sql === "COMMIT") commits += 1;
				if (sql === "ROLLBACK") rollbacks += 1;
				const promise = Promise.resolve<readonly Record<string, unknown>[]>([]);
				const control: DeferredQuery = {
					cancel: () => control,
					execute: () => control,
					// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
					then: promise.then.bind(promise),
				};
				return control;
			}
			calls.push({ sql, parameters });
			let rejectQuery: (reason?: unknown) => void = () => {};
			const promise = new Promise<readonly Record<string, unknown>[]>(
				(resolve, reject) => {
					rejectQuery = reject;
					if (block) {
						rejectActive = reject;
						started?.();
					} else resolve([{ qp_key_outcome: "found" }]);
				},
			);
			const query: DeferredQuery = {
				cancel: () => {
					cancellations += 1;
					rejectQuery(new Error("query cancelled"));
					return query;
				},
				execute: () => query,
				// oxlint-disable-next-line unicorn/no-thenable -- Bun PendingQuery is intentionally awaitable.
				then: promise.then.bind(promise),
			};
			return query;
		},
	};
	const sql = {
		async reserve() {
			return transaction;
		},
	};
	return {
		calls,
		controlStatements,
		startedPromise,
		get cancellations() {
			return cancellations;
		},
		get commits() {
			return commits;
		},
		get rollbacks() {
			return rollbacks;
		},
		get closes() {
			return closes;
		},
		get releases() {
			return releases;
		},
		setBlock(value: boolean) {
			block = value;
		},
		sql: sql as unknown as SQL,
	};
}

test("runs static SQL in one pinned read-only repeatable-read transaction", async () => {
	const database = fakeSql();
	const outcome = await executePostgresKeyedOutcome(database.sql, {
		statement: "SELECT $1::integer AS value\n",
		parameters: [1],
	});

	expect(outcome).toBe("found");
	expect(database.controlStatements).toEqual([
		"BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
		"COMMIT",
	]);
	expect(database.calls).toEqual([
		{ sql: "SELECT $1::integer AS value\n", parameters: [1] },
	]);
	expect(database.commits).toBe(1);
	expect(database.rollbacks).toBe(0);
	expect(database.releases).toBe(1);
});

test("cancels and disconnects the Bun query while keeping the injected pool reusable", async () => {
	const database = fakeSql();
	const controller = new AbortController();
	database.setBlock(true);
	const blocked = executePostgresKeyedOutcome(database.sql, {
		statement: "SELECT blocked\n",
		parameters: [],
		signal: controller.signal,
	});
	await database.startedPromise;
	controller.abort(new Error("stop"));
	await expect(blocked).rejects.toThrow("query cancelled");
	expect(database.cancellations).toBe(1);
	expect(database.closes).toBe(1);
	expect(database.rollbacks).toBe(1);

	database.setBlock(false);
	const outcome = await executePostgresKeyedOutcome(database.sql, {
		statement: "SELECT reusable\n",
		parameters: [],
	});
	expect(outcome).toBe("found");
	expect(database.commits).toBe(1);
	expect(database.releases).toBe(2);
});
