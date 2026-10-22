import { expect, test } from "bun:test";

import { GraphileWorkerAdapter } from "../../src/exports/adapters/graphile-worker.js";

function cleanupHarness() {
	const adapter = new GraphileWorkerAdapter({ connectionString: "unused" });
	const queries: { text: string; values: unknown[] }[] = [];
	let page: { job_id: string; removable: boolean }[] = [];
	let failCommit = false;
	let end = "9223372036854775807";
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
					return {
						rows: text.startsWith("SELECT r.job_id")
							? page
							: text.startsWith("SELECT job_id AS pass_end")
								? [{ pass_end: end }]
								: [],
					};
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
		setEnd(value: string) {
			end = value;
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
		"-9223372036854775808",
		locked.at(-1)!.job_id,
		"-9223372036854775808",
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
	expect(pages.map((query) => query.values[0])).toEqual([
		"-9223372036854775808",
		"-9223372036854775808",
	]);
});

test("retired passes include the bigint minimum and wrap despite a growing high-water mark", async () => {
	const harness = cleanupHarness();
	harness.setEnd("499");
	harness.setPage(
		Array.from({ length: 500 }, (_, index) => ({
			job_id: String(index),
			removable: false,
		})),
	);
	await harness.tick();
	harness.setEnd("999");
	harness.setPage([{ job_id: "-9223372036854775808", removable: true }]);
	await harness.tick();
	const pages = harness.queries.filter((query) =>
		query.text.startsWith("SELECT r.job_id"),
	);
	expect(pages.map((query) => query.values.slice(0, 2))).toEqual([
		["-9223372036854775808", "499"],
		["-9223372036854775808", "999"],
	]);
	expect(pages[0].text).toContain("job_id >=");
	expect(pages[1].text).toContain("job_id >=");
	const deletion = harness.queries.find(
		(query) =>
			query.text.startsWith("DELETE FROM") &&
			query.text.includes('"questpie_retired_jobs"'),
	)!;
	expect(deletion.text).toContain(")) AND (SELECT j.id");
	expect(deletion.text).toContain("WHERE j.id = r.job_id LIMIT 1) IS NULL");
});
