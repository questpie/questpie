import { Buffer } from "node:buffer";

import {
	type ExecutorRunOptions,
	type ExecutorRunResult,
	SandboxBroker,
} from "questpie/executor";
import { describe, expect, it } from "vitest";

import { appPathPrefix } from "../apps/app-resolver";
import appRoute, {
	buildEndpointEntrySource,
} from "../routes/apps/[appId]/[fn]";

// ---------------------------------------------------------------------------
// Route-level proof WITHOUT a live DB or the Deno sandbox.
//
// IMPORTANT harness note: the guest→broker→target bindings round-trip needs the
// real Deno sandbox service (it relays the guest's framed RPCs). Furthermore,
// NEITHER adapter's guest source can be executed under Vitest — Vitest's module
// resolver cannot load the `data:`/`blob:` URLs the adapters import (a harness
// limitation, not a runtime one; both Bun and Deno load them fine). So we do NOT
// execute the composed source here. Instead:
//   1. assert the route resolves the app, validates `fn`, and calls
//      `executor.run` with `isolation:"sandboxed"`, the manifest capabilities,
//      the bindings TARGET, and the origin-derived broker URL;
//   2. assert the composed entry source's STRUCTURE (a single default that
//      imports the app module + selects the requested export by name);
//   3. drive the EXACT target the route built through the real broker to confirm
//      G1/G2/G3 are wired (not just the helper in isolation).
// The composed source's runtime DISPATCH is verified separately against real
// Deno (see the task report / scripts).
// ---------------------------------------------------------------------------

interface KRow {
	id: string;
	path: string;
	title: string | null;
	body: string;
	contentType: string | null;
	metadata: Record<string, unknown> | null;
}

function knowledgeCollections(rows: KRow[]) {
	return {
		assets: {
			async find({ where }: { where: { path: { startsWith: string } } }) {
				const prefix = where.path.startsWith;
				return { docs: rows.filter((r) => r.path.startsWith(prefix)) };
			},
		},
		// A granted data collection (manifest grants `posts: ["read"]`) so the target
		// builds a `posts` accessor — used by the route-level G3 oracle proof.
		posts: {
			async find() {
				return { docs: [] };
			},
			async findOne() {
				return null;
			},
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
				return {
					ok: true,
					output: { echoed: opts.input },
					logs: [],
					...result,
				};
			},
		},
	};
}

const APP = "social";
const PREFIX = appPathPrefix(APP);

const MANIFEST = {
	name: "Social",
	entry: "server.ts",
	capabilities: {
		data: { collections: { posts: ["read"] } },
		files: {
			read: [`${PREFIX}data/**`],
			write: [`${PREFIX}data/**`],
		},
		timeoutMs: 5000,
	},
};

function seed(entry: string): KRow[] {
	return [
		{
			id: "m",
			path: `${PREFIX}_app/manifest.json`,
			title: null,
			body: JSON.stringify(MANIFEST),
			contentType: "application/json",
			metadata: null,
		},
		{
			id: "s",
			path: `${PREFIX}_app/server.ts`,
			title: null,
			body: entry,
			contentType: "text/typescript",
			metadata: null,
		},
	];
}

function callRoute(opts: {
	rows: KRow[];
	executor: { isEnabled: boolean; run: (o: ExecutorRunOptions) => unknown };
	appId: string;
	fn: string;
	method?: string;
	body?: string;
	contentType?: string;
	extraHeaders?: Record<string, string>;
	/** Host header to spoof (the request URL host); proves it does NOT drive brokerUrl. */
	host?: string;
	/** `config.executor.brokerUrl` the app exposes (the TRUSTED broker URL source). */
	brokerUrl?: string;
	/** Relation field names per collection (drives the G3 where/orderBy guard). */
	relationFields?: Record<string, string[]>;
}): Promise<Response> {
	const method = opts.method ?? "POST";
	const host = opts.host ?? "app.test";
	const url = `https://${host}/api/apps/${opts.appId}/${opts.fn}`;
	const headers: Record<string, string> = { ...(opts.extraHeaders ?? {}) };
	if (opts.contentType) headers["content-type"] = opts.contentType;
	const request = new Request(url, {
		method,
		headers,
		...(method === "POST" || method === "PUT" || method === "PATCH"
			? { body: opts.body ?? "" }
			: {}),
	});
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
		collections: knowledgeCollections(opts.rows),
		services: {
			knowledgeResource: {
				async readByPath() {
					return null;
				},
				async writeByPath(input: { path: string; body: string }) {
					return {
						id: "x",
						path: input.path,
						title: null,
						body: input.body,
						contentType: null,
						metadata: null,
					};
				},
				async listByPrefix() {
					return [];
				},
			},
		},
		session: { user: { id: "user_1" } },
		request,
		params: { appId: opts.appId, fn: opts.fn },
	};
	return (appRoute as { handler: (c: unknown) => Promise<Response> }).handler(
		ctx,
	);
}

// ──────────────────────── composed entry source (unit) ──────────────────────

describe("buildEndpointEntrySource", () => {
	const APP_SRC =
		"export default ()=> 'DEF'; export function webhook(){ return 'WH'; }";

	it("embeds the app source (base64) and selects the requested export", () => {
		const out = buildEndpointEntrySource(APP_SRC, "webhook");
		// app source embedded verbatim as base64 (no parsing/rewriting of it).
		expect(out).toContain(Buffer.from(APP_SRC, "utf8").toString("base64"));
		// the requested export name drives selection.
		expect(out).toContain('"webhook"');
		// exactly ONE default export (the dispatcher) — the app module is imported,
		// never given a second default.
		expect(out.match(/export\s+default/g)).toHaveLength(1);
		// it imports the app module + has the not-a-function guard.
		expect(out).toContain("await import(");
		expect(out).toContain("is not an exported function");
	});

	it("selects the default export when fn === 'default'", () => {
		const out = buildEndpointEntrySource(APP_SRC, "default");
		expect(out).toContain('__FN === "default" ? __mod.default');
	});
});

// ──────────────────────────── route dispatch ───────────────────────────────

describe("named-endpoint route", () => {
	it("calls executor.run with sandboxed isolation, caps, target, broker URL", async () => {
		const entry = [
			"export default async function(){ return 1; }",
			"export const cron = async () => {};",
		].join("\n");
		const stub = recordingExecutor();
		const res = await callRoute({
			rows: seed(entry),
			executor: stub.executor,
			appId: APP,
			fn: "default",
			body: JSON.stringify({ a: 1 }),
			contentType: "application/json",
			brokerUrl: "http://127.0.0.1:3000/api/sandbox/rpc",
		});
		expect(res.status).toBe(200);

		expect(stub.calls).toHaveLength(1);
		const call = stub.calls[0]!;
		expect(call.isolation).toBe("sandboxed");
		// manifest capabilities flow through verbatim.
		expect(
			(
				call.capabilities as {
					data?: { collections?: Record<string, unknown> };
				}
			).data?.collections,
		).toHaveProperty("posts");
		// the bindings TARGET (security boundary object) is present + shaped.
		const target = call.appBindings as {
			files?: object;
			collections?: object;
		};
		expect(target.files).toBeTruthy();
		expect(target.collections).toBeTruthy();
		// broker URL comes from CONFIG, NOT the request origin.
		expect(call.brokerUrl).toBe("http://127.0.0.1:3000/api/sandbox/rpc");
		// the JSON body reached the guest input.
		const input = call.input as {
			body?: unknown;
			fn?: string;
			method?: string;
		};
		expect(input.body).toEqual({ a: 1 });
		expect(input.fn).toBe("default");
		expect(input.method).toBe("POST");
		// the composed source selects the default endpoint.
		expect(call.source).toContain('__FN === "default"');
	});

	it("dispatches a NAMED endpoint (source selects it)", async () => {
		const entry = [
			"export default async function(){ return 'DEFAULT'; }",
			"export async function webhook(input){ return input.method; }",
		].join("\n");
		const stub = recordingExecutor();
		const res = await callRoute({
			rows: seed(entry),
			executor: stub.executor,
			appId: APP,
			fn: "webhook",
		});
		expect(res.status).toBe(200);
		expect(stub.calls[0]!.source).toContain('"webhook"');
	});

	it("STRIPS the caller's credential headers from the guest input", async () => {
		const stub = recordingExecutor();
		await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
			extraHeaders: {
				authorization: "Bearer SECRET",
				cookie: "session=SECRET",
				"x-questpie-sandbox-token": "TOKEN",
				"x-forwarded-for": "1.2.3.4",
				"x-custom-app-header": "ok-to-pass",
			},
		});
		const input = stub.calls[0]!.input as { headers: Record<string, string> };
		// untrusted guest must NOT receive the caller's auth/credentials.
		expect(input.headers.authorization).toBeUndefined();
		expect(input.headers.cookie).toBeUndefined();
		expect(input.headers["x-questpie-sandbox-token"]).toBeUndefined();
		expect(input.headers["x-forwarded-for"]).toBeUndefined();
		// a benign app-specific header is still passed through.
		expect(input.headers["x-custom-app-header"]).toBe("ok-to-pass");
	});

	it("the target handed to the run enforces G1 via the real broker", async () => {
		const entry = "export default async function(){ return 1; }";
		const stub = recordingExecutor();
		await callRoute({
			rows: seed(entry),
			executor: stub.executor,
			appId: APP,
			fn: "default",
		});
		const call = stub.calls[0]!;
		const broker = new SandboxBroker();
		const { token } = broker.mint({
			capabilities: (call.capabilities as never) ?? {},
			target: call.appBindings as never,
		});
		// manifest write glob is the app's OWN data/, but the host bound also forbids
		// escaping the tenant subtree: another app's _app/ is rejected.
		const evil = await broker.handleRpc(token, "files.write", {
			path: "company/apps/other/_app/manifest.json",
			body: "x",
		});
		expect(evil.ok).toBe(false);
	});

	// ── FIX #1: a SPOOFED `Host` must NOT drive the broker URL (token exfiltration) ──
	it("ignores a spoofed Host header — brokerUrl comes from CONFIG", async () => {
		const stub = recordingExecutor();
		await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
			host: "evil.example", // attacker-controlled Host on the request URL
			brokerUrl: "http://127.0.0.1:3000/api/sandbox/rpc",
		});
		const call = stub.calls[0]!;
		// the supervisor would mail the per-run token here — it MUST be the config
		// value, never the spoofed origin.
		expect(call.brokerUrl).toBe("http://127.0.0.1:3000/api/sandbox/rpc");
		expect(call.brokerUrl).not.toContain("evil.example");
	});

	it("falls back to loopback (never the request Host) when no config/env is set", async () => {
		const stub = recordingExecutor();
		await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
			host: "evil.example",
			// no brokerUrl config, and SANDBOX_BROKER_URL unset in this test env.
		});
		const call = stub.calls[0]!;
		expect(call.brokerUrl).toContain("127.0.0.1");
		expect(call.brokerUrl).not.toContain("evil.example");
	});

	// ── FIX #3 (route-level): a relation-referencing `where` is rejected end-to-end ──
	it("the target rejects a `where` that names a relation (oracle)", async () => {
		const stub = recordingExecutor();
		await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
			relationFields: { posts: ["author"] },
		});
		const call = stub.calls[0]!;
		const broker = new SandboxBroker();
		const { token } = broker.mint({
			capabilities: (call.capabilities as never) ?? {},
			target: call.appBindings as never,
		});
		// a relation reference in `where` → denied (would be a raw EXISTS oracle).
		const oracle = await broker.handleRpc(token, "collections.posts.find", {
			where: { author: { id: "secret" } },
		});
		expect(oracle.ok).toBe(false);
		// a plain scalar `where` on the same collection still works.
		const ok = await broker.handleRpc(token, "collections.posts.find", {
			where: { title: "hi" },
		});
		expect(ok.ok).toBe(true);
	});

	// Resolution/validation failures THROW `ApiError` (the HTTP adapter maps them
	// to statuses uniformly, like the sibling fs route); calling the handler
	// directly surfaces the rejection, so we assert on the error code.
	it("rejects NOT_FOUND when fn is a cron export (not an HTTP endpoint)", async () => {
		const entry = [
			"export default async function(){ return 1; }",
			"export const cron = async () => {};",
		].join("\n");
		const stub = recordingExecutor();
		await expect(
			callRoute({
				rows: seed(entry),
				executor: stub.executor,
				appId: APP,
				fn: "cron",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(stub.calls).toHaveLength(0);
	});

	it("rejects NOT_FOUND for an unknown endpoint name", async () => {
		const stub = recordingExecutor();
		await expect(
			callRoute({
				rows: seed("export default async function(){ return 1; }"),
				executor: stub.executor,
				appId: APP,
				fn: "nope",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(stub.calls).toHaveLength(0);
	});

	it("rejects BAD_REQUEST on invalid JSON body (before any run)", async () => {
		const stub = recordingExecutor();
		await expect(
			callRoute({
				rows: seed("export default async function(){ return 1; }"),
				executor: stub.executor,
				appId: APP,
				fn: "default",
				method: "POST",
				body: "{not json",
				contentType: "application/json",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		expect(stub.calls).toHaveLength(0);
	});

	it("maps a guest-failure result to 500", async () => {
		const stub = recordingExecutor({
			ok: false,
			error: "boom in guest",
			logs: [],
		});
		const res = await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
		});
		expect(res.status).toBe(500);
		const json = (await res.json()) as { ok: boolean; error: string };
		expect(json.ok).toBe(false);
		expect(json.error).toContain("boom in guest");
	});

	it("maps a timed-out result to 504", async () => {
		const stub = recordingExecutor({
			ok: false,
			error: "soft timeout exceeded",
			timedOut: true,
			logs: [],
		});
		const res = await callRoute({
			rows: seed("export default async function(){ return 1; }"),
			executor: stub.executor,
			appId: APP,
			fn: "default",
		});
		expect(res.status).toBe(504);
	});

	it("rejects BAD_REQUEST when the executor is not configured", async () => {
		await expect(
			callRoute({
				rows: seed("export default async function(){ return 1; }"),
				executor: { isEnabled: false, run: async () => ({}) as never },
				appId: APP,
				fn: "default",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});
