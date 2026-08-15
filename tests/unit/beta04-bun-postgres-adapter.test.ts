import { expect, test } from "bun:test";

import type { SQL } from "bun";

import { createBunPostgresQueryAdapter } from "../../packages/runtime/src";

interface DeferredQuery {
	cancel(): DeferredQuery;
	execute(): DeferredQuery;
	then: Promise<readonly Record<string, unknown>[]>["then"];
}

function fakeSql() {
	const calls: Array<
		Readonly<{ sql: string; parameters: readonly unknown[] }>
	> = [];
	const beginModes: string[] = [];
	let cancellations = 0;
	let commits = 0;
	let rollbacks = 0;
	let block = false;
	let started: (() => void) | undefined;
	const startedPromise = new Promise<void>((resolve) => {
		started = resolve;
	});
	const transaction = {
		unsafe(sql: string, parameters: readonly unknown[]): DeferredQuery {
			calls.push({ sql, parameters });
			let rejectQuery: (reason?: unknown) => void = () => {};
			const promise = new Promise<readonly Record<string, unknown>[]>(
				(resolve, reject) => {
					rejectQuery = reject;
					if (block) started?.();
					else resolve([{ value: 1 }]);
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
		async begin<Result>(
			mode: string,
			use: (value: typeof transaction) => Promise<Result>,
		): Promise<Result> {
			beginModes.push(mode);
			try {
				const result = await use(transaction);
				commits += 1;
				return result;
			} catch (error) {
				rollbacks += 1;
				throw error;
			}
		},
	};
	return {
		calls,
		beginModes,
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
		setBlock(value: boolean) {
			block = value;
		},
		sql: sql as unknown as SQL,
	};
}

test("runs static SQL in one pinned read-only repeatable-read transaction", async () => {
	const database = fakeSql();
	const adapter = createBunPostgresQueryAdapter(database.sql);
	const rows = await adapter.transaction(
		{ isolationLevel: "repeatable read", readOnly: true },
		(transaction) =>
			transaction.query("SELECT $1::integer AS value\n", [1], {}),
	);

	expect(rows).toEqual([{ value: 1 }]);
	expect(database.beginModes).toEqual([
		"isolation level repeatable read read only",
	]);
	expect(database.calls).toEqual([
		{ sql: "SELECT $1::integer AS value\n", parameters: [1] },
	]);
	expect(database.commits).toBe(1);
	expect(database.rollbacks).toBe(0);
});

test("cancels the Bun query, rolls back, and keeps the injected pool reusable", async () => {
	const database = fakeSql();
	const adapter = createBunPostgresQueryAdapter(database.sql);
	const controller = new AbortController();
	database.setBlock(true);
	const blocked = adapter.transaction(
		{
			isolationLevel: "repeatable read",
			readOnly: true,
			signal: controller.signal,
		},
		(transaction) =>
			transaction.query("SELECT blocked\n", [], {
				signal: controller.signal,
			}),
	);
	await database.startedPromise;
	controller.abort(new Error("stop"));
	await expect(blocked).rejects.toThrow("query cancelled");
	expect(database.cancellations).toBe(1);
	expect(database.rollbacks).toBe(1);

	database.setBlock(false);
	const rows = await adapter.transaction(
		{ isolationLevel: "repeatable read", readOnly: true },
		(transaction) => transaction.query("SELECT reusable\n", [], {}),
	);
	expect(rows).toEqual([{ value: 1 }]);
	expect(database.commits).toBe(1);
	expect(database.beginModes).toHaveLength(2);
});
