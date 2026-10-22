import { expect, test } from "bun:test";

import { GraphileWorkerAdapter } from "../../src/exports/adapters/graphile-worker.js";

function cleanupHarness() {
	const adapter = new GraphileWorkerAdapter({ connectionString: "unused" });
	const queries: { text: string; values: unknown[] }[] = [];
	let page: { job_id: string; removable: boolean }[] = [];
	let failCommit = false;
	const internal = adapter as unknown as {
		pool: unknown;
		tickSchedules(): Promise<void>;
	};
	internal.pool = {
		async connect() {
			return {
				async query(text: string, values: unknown[] = []) {
					queries.push({ text, values });
					if (text === "COMMIT" && failCommit) throw new Error("commit failed");
					return { rows: text.startsWith("SELECT r.job_id") ? page : [] };
				},
				release() {},
			};
		},
	};
	return {
		queries,
		tick: () => internal.tickSchedules(),
		setPage(rows: typeof page) {
			page = rows;
		},
		setFailCommit(fail: boolean) {
			failCommit = fail;
		},
	};
}

test("retired cursor advances across a fully locked page and wraps after an empty page", async () => {
	const harness = cleanupHarness();
	const start = 9007199254740993n;
	const locked = Array.from({ length: 500 }, (_, index) => ({
		job_id: String(start + BigInt(index)),
		removable: false,
	}));
	harness.setPage(locked);
	await harness.tick();
	harness.setPage([]);
	await harness.tick();
	harness.setPage([{ job_id: "1", removable: true }]);
	await harness.tick();
	const pages = harness.queries.filter((query) =>
		query.text.startsWith("SELECT r.job_id"),
	);
	expect(pages.map((query) => query.values[0])).toEqual([
		"0",
		locked.at(-1)!.job_id,
		"0",
	]);
	const completions = harness.queries.filter((query) =>
		query.text.includes('"complete_jobs"'),
	);
	expect(completions).toHaveLength(1);
	expect(completions[0].text).toContain('"complete_jobs"($1::bigint[])');
	expect(completions[0].values).toEqual([["1"]]);
});

test("a failed cleanup commit retries the same ledger page", async () => {
	const harness = cleanupHarness();
	harness.setPage(
		Array.from({ length: 500 }, (_, index) => ({
			job_id: String(index + 1),
			removable: false,
		})),
	);
	harness.setFailCommit(true);
	await expect(harness.tick()).rejects.toThrow("commit failed");
	expect(harness.queries.at(-1)!.text).toBe("ROLLBACK");
	harness.setFailCommit(false);
	await harness.tick();
	const pages = harness.queries.filter((query) =>
		query.text.startsWith("SELECT r.job_id"),
	);
	expect(pages.map((query) => query.values[0])).toEqual(["0", "0"]);
});
