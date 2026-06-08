import {
	type ExecutorRunOptions,
	type ExecutorRunResult,
	SandboxBroker,
} from "questpie/executor";
import { describe, expect, it } from "vitest";

import { appBundlePrefix, appDataPrefix } from "../apps/app-resolver";
import { pickCronExport, triggerAppSchedule } from "../jobs/schedule-tick";

// ---------------------------------------------------------------------------
// M5 cron runner proof WITHOUT a live DB or the Deno sandbox (mirrors the M4
// route test `mini-app-route.test.ts`). The guest→broker→target round-trip needs
// the real Deno sandbox, and Vitest cannot load the `data:` URLs the adapters
// import (a harness limitation, not a runtime one). So we do NOT execute the
// composed source here. Instead we:
//   1. drive `triggerAppSchedule` with a test-double ctx and assert it calls
//      `executor.run` with `isolation:"sandboxed"`, the manifest capabilities,
//      the bindings TARGET, and the CONFIG (never request-derived) broker URL;
//   2. assert a `run_links` row (with `metadata.stepType:"app"`) AND a
//      `schedule_executions` row are created + updated with the run result;
//   3. drive the EXACT target the runner built through the real broker to confirm
//      G1/G2/G3 are wired for cron too (not just the helper in isolation).
// No live-server smoke (no live DB available in this harness).
// ---------------------------------------------------------------------------

const APP = "social";
const BUNDLE = appBundlePrefix(APP);
const DATA = appDataPrefix(APP);

/** Inline manifest source prepended into every seeded `.app` `server.ts`. */
const MANIFEST_SRC = [
	`export const manifest = {`,
	`  name: "Social",`,
	`  capabilities: {`,
	`    data: { collections: { posts: ["read"] } },`,
	`    files: { read: ["${BUNDLE}**", "${DATA}**"], write: ["${DATA}**"] },`,
	`    timeoutMs: 5000,`,
	`  },`,
	`};`,
].join("\n");

/**
 * The opt-in `actions` registry the resolver requires (cron apps still need one,
 * even if empty — the HTTP surface is opt-in). A single `noop` action keeps the
 * resolver happy without exposing the cron handlers as HTTP.
 */
const ACTIONS_SRC = [
	"async function noop(){ return null; }",
	"export const actions = { noop };",
].join("\n");

interface KRow {
	path: string;
	body: string;
}

/** Build a `.app` bundle from a cron-defining body (manifest + actions prepended). */
function seed(entry: string): KRow[] {
	return [
		{ path: `${BUNDLE}server.ts`, body: `${MANIFEST_SRC}\n${entry}\n${ACTIONS_SRC}` },
	];
}

/** A recording row store standing in for a DB-backed collection. */
function recordingCollection() {
	const rows: Array<Record<string, unknown> & { id: string }> = [];
	let seq = 0;
	return {
		rows,
		async create(data: Record<string, unknown>) {
			const row = { id: `row_${++seq}`, ...data };
			rows.push(row);
			return row;
		},
		async updateById({
			id,
			data,
		}: {
			id: string;
			data: Record<string, unknown>;
		}) {
			const row = rows.find((r) => r.id === id);
			if (row) Object.assign(row, data);
			return row;
		},
	};
}

/** A NON-executing executor stub that only records the run options. */
function recordingExecutor(result?: Partial<ExecutorRunResult>) {
	const calls: ExecutorRunOptions[] = [];
	return {
		calls,
		executor: {
			isEnabled: true,
			async run(opts: ExecutorRunOptions): Promise<ExecutorRunResult> {
				calls.push(opts);
				return { ok: true, output: { ran: opts.input }, logs: [], ...result };
			},
		},
	};
}

function buildCtx(opts: {
	rows: KRow[];
	executor: { isEnabled: boolean; run: (o: ExecutorRunOptions) => unknown };
	brokerUrl?: string;
	relationFields?: Record<string, string[]>;
}) {
	const runLinks = recordingCollection();
	const scheduleExecutions = recordingCollection();
	const activity = recordingCollection();
	const ctx = {
		app: {
			executor: opts.executor,
			config: opts.brokerUrl
				? { executor: { brokerUrl: opts.brokerUrl } }
				: undefined,
			getCollectionConfig: (name: string) => ({
				getMeta: () => ({ relations: opts.relationFields?.[name] ?? [] }),
			}),
		},
		collections: {
			assets: {
				async find({ where }: { where: { path: { startsWith: string } } }) {
					const prefix = where.path.startsWith;
					return { docs: opts.rows.filter((r) => r.path.startsWith(prefix)) };
				},
			},
			// A granted data collection so the target builds a `posts` accessor
			// (used by the G3 oracle proof below).
			posts: {
				async find() {
					return { docs: [] };
				},
				async findOne() {
					return null;
				},
			},
			run_links: runLinks,
			schedule_executions: scheduleExecutions,
			activity,
		},
		// No HTTP session on a cron → the synthesized app-principal is used.
		session: null,
	};
	return { ctx, runLinks, scheduleExecutions, activity };
}

const ENTRY_ONE_CRON = [
	"export default async function(){ return 'HTTP'; }",
	"export async function cron(input){ return input.trigger; }",
].join("\n");

const NOW = new Date("2026-06-05T09:00:00.000Z");

describe("pickCronExport", () => {
	it("returns the named cron export when appFn is set + declared", () => {
		expect(
			pickCronExport([{ name: "cron" }, { name: "cronDigest" }], "cronDigest", APP),
		).toBe("cronDigest");
	});

	it("defaults to the single declared cron when appFn is omitted", () => {
		expect(pickCronExport([{ name: "cron" }], undefined, APP)).toBe("cron");
	});

	it("throws when appFn names an export that is not a declared cron", () => {
		expect(() => pickCronExport([{ name: "cron" }], "nope", APP)).toThrow(
			/no cron export "nope"/,
		);
	});

	it("throws when no cron export is declared", () => {
		expect(() => pickCronExport([], undefined, APP)).toThrow(/no cron export/);
	});

	it("throws (ambiguous) when many crons exist and appFn is omitted", () => {
		expect(() =>
			pickCronExport([{ name: "cron" }, { name: "cronDigest" }], undefined, APP),
		).toThrow(/multiple cron exports/);
	});
});

describe("triggerAppSchedule", () => {
	it("runs the cron export sandboxed with caps, target, CONFIG broker URL", async () => {
		const stub = recordingExecutor();
		const { ctx, runLinks, scheduleExecutions } = buildCtx({
			rows: seed(ENTRY_ONE_CRON),
			executor: stub.executor,
			brokerUrl: "http://127.0.0.1:3000/api/sandbox/rpc",
		});

		const schedule = { id: "sch_1", mode: "app", appId: APP };
		const result = await triggerAppSchedule(ctx as never, schedule, NOW);

		// one sandboxed run with the manifest capabilities + bindings target.
		expect(stub.calls).toHaveLength(1);
		const call = stub.calls[0]!;
		expect(call.isolation).toBe("sandboxed");
		expect(
			(call.capabilities as { data?: { collections?: Record<string, unknown> } })
				.data?.collections,
		).toHaveProperty("posts");
		const target = call.appBindings as {
			files?: object;
			collections?: object;
		};
		expect(target.files).toBeTruthy();
		expect(target.collections).toBeTruthy();
		// broker URL comes from CONFIG, never the request (a cron has no request).
		expect(call.brokerUrl).toBe("http://127.0.0.1:3000/api/sandbox/rpc");
		// the composed source selects the cron export by name.
		expect(call.source).toContain('"cron"');
		// the cron tick payload reached the guest input.
		const input = call.input as { trigger?: string; scheduleId?: string };
		expect(input.trigger).toBe("cron");
		expect(input.scheduleId).toBe("sch_1");

		// run_links row with stepType:"app", updated to completed.
		expect(runLinks.rows).toHaveLength(1);
		const run = runLinks.rows[0]!;
		expect((run.metadata as { stepType?: string }).stepType).toBe("app");
		expect(run.initiatedBy).toBe("schedule");
		expect(run.schedule).toBe("sch_1");
		expect(run.status).toBe("completed");
		expect(run.endedAt).toBeTruthy();

		// schedule_executions row linking the run, mode:"app".
		expect(scheduleExecutions.rows).toHaveLength(1);
		const exec = scheduleExecutions.rows[0]!;
		expect(exec.schedule).toBe("sch_1");
		expect(exec.run).toBe(run.id);
		expect(exec.status).toBe("triggered");
		expect((exec.metadata as { mode?: string }).mode).toBe("app");

		// the trigger reports the created execution + run + ok.
		expect(result).toMatchObject({
			executionId: exec.id,
			runId: run.id,
			ok: true,
		});
	});

	it("falls back to loopback when no broker config/env is set (never a request host)", async () => {
		const stub = recordingExecutor();
		const { ctx } = buildCtx({
			rows: seed(ENTRY_ONE_CRON),
			executor: stub.executor,
			// no brokerUrl config; SANDBOX_BROKER_URL unset in this test env.
		});
		await triggerAppSchedule(ctx as never, { id: "s", mode: "app", appId: APP }, NOW);
		expect(stub.calls[0]!.brokerUrl).toContain("127.0.0.1");
	});

	it("selects the named cron export when the schedule sets appFn", async () => {
		const entry = [
			"export const cron = async () => 'A';",
			"export const cronDigest = async () => 'B';",
		].join("\n");
		const stub = recordingExecutor();
		const { ctx } = buildCtx({ rows: seed(entry), executor: stub.executor });
		await triggerAppSchedule(
			ctx as never,
			{ id: "s", mode: "app", appId: APP, appFn: "cronDigest" },
			NOW,
		);
		expect(stub.calls[0]!.source).toContain('"cronDigest"');
	});

	it("records a failed run + still creates the execution when the guest fails", async () => {
		const stub = recordingExecutor({ ok: false, error: "boom in guest", logs: [] });
		const { ctx, runLinks, scheduleExecutions } = buildCtx({
			rows: seed(ENTRY_ONE_CRON),
			executor: stub.executor,
		});
		const result = await triggerAppSchedule(
			ctx as never,
			{ id: "s", mode: "app", appId: APP },
			NOW,
		);
		expect(result.ok).toBe(false);
		expect(runLinks.rows[0]!.status).toBe("failed");
		expect(runLinks.rows[0]!.error).toContain("boom in guest");
		// the execution row is still recorded (observability before the run).
		expect(scheduleExecutions.rows).toHaveLength(1);
	});

	it("throws when the executor is not configured", async () => {
		const { ctx } = buildCtx({
			rows: seed(ENTRY_ONE_CRON),
			executor: { isEnabled: false, run: async () => ({}) as never },
		});
		await expect(
			triggerAppSchedule(ctx as never, { id: "s", mode: "app", appId: APP }, NOW),
		).rejects.toThrow(/executor is not configured/);
	});

	it("throws when the schedule has no appId", async () => {
		const stub = recordingExecutor();
		const { ctx } = buildCtx({ rows: seed(ENTRY_ONE_CRON), executor: stub.executor });
		await expect(
			triggerAppSchedule(ctx as never, { id: "s", mode: "app" }, NOW),
		).rejects.toThrow(/no appId/);
	});

	// ── the cron-built target enforces G1 (tenant outer-bound) via the REAL broker ──
	it("the target handed to the run enforces G1 via the real broker", async () => {
		const stub = recordingExecutor();
		const { ctx } = buildCtx({ rows: seed(ENTRY_ONE_CRON), executor: stub.executor });
		await triggerAppSchedule(ctx as never, { id: "s", mode: "app", appId: APP }, NOW);
		const call = stub.calls[0]!;
		const broker = new SandboxBroker();
		const { token } = broker.mint({
			capabilities: (call.capabilities as never) ?? {},
			target: call.appBindings as never,
		});
		// another app's .app bundle is rejected (host bound forbids escaping the tenant).
		const evil = await broker.handleRpc(token, "files.write", {
			path: "company/apps/other.app/server.ts",
			body: "x",
		});
		expect(evil.ok).toBe(false);
	});

	// ── the cron-built target rejects a relation-referencing `where` (G3 oracle) ──
	it("the target rejects a `where` that names a relation (oracle) for cron too", async () => {
		const stub = recordingExecutor();
		const { ctx } = buildCtx({
			rows: seed(ENTRY_ONE_CRON),
			executor: stub.executor,
			relationFields: { posts: ["author"] },
		});
		await triggerAppSchedule(ctx as never, { id: "s", mode: "app", appId: APP }, NOW);
		const call = stub.calls[0]!;
		const broker = new SandboxBroker();
		const { token } = broker.mint({
			capabilities: (call.capabilities as never) ?? {},
			target: call.appBindings as never,
		});
		const oracle = await broker.handleRpc(token, "collections.posts.find", {
			where: { author: { id: "secret" } },
		});
		expect(oracle.ok).toBe(false);
		const ok = await broker.handleRpc(token, "collections.posts.find", {
			where: { title: "hi" },
		});
		expect(ok.ok).toBe(true);
	});
});
