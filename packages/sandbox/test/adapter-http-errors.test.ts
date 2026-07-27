/**
 * UNIT tests for `adapter-http.ts` ERROR PATHS — no Deno, no real sandbox.
 *
 * The HTTP adapter is just a JSON-over-HTTP client; its failure handling can be
 * exercised entirely against a tiny `Bun.serve` stub (or a dead port / a custom
 * `fetch`) standing in for the Deno sandbox service. None of these cases spawn a
 * guest, so — unlike `bindings-e2e.test.ts` — they need no `deno` on PATH and run
 * unconditionally in CI.
 *
 * Covered (exact error strings asserted against the adapter source):
 *   1. fetch timeout      — server never responds + small `fetchTimeoutMs` →
 *                           "sandbox request timed out after <ms>ms" (no hang).
 *   2. network failure    — dead port → "sandbox request failed: ..." (structured).
 *   3. non-JSON response  — HTML/empty body → "sandbox returned non-JSON (HTTP <status>): ...".
 *   4. URL normalization  — base url WITH and WITHOUT a trailing slash both POST
 *                           to exactly one `/run` (no `//run`).
 *   5. custom `fetch`     — `options.fetch` is honored over `globalThis.fetch`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";

import { httpSandboxAdapter } from "../src/adapter-http.js";
import { registerSandboxCustomToolsSession } from "../src/custom-tools.js";

// Capabilities with empty net/import so egress validation is a no-op
// (validateEgressHosts([]) → { ok: true }) and the adapter proceeds to fetch.
const BASE_CAPS = { net: [], import: [], timeoutMs: 5000, memoryMb: 128 };

/** A minimal run() invocation. Cast `as never` like the sibling e2e test. */
function runOnce(
	adapter: ReturnType<typeof httpSandboxAdapter>,
	overrides: Record<string, unknown> = {},
) {
	return adapter.run({
		source: "export default async () => 1",
		isolation: "sandboxed",
		capabilities: BASE_CAPS,
		...overrides,
	} as never);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. fetch timeout — server that never responds is bounded by fetchTimeoutMs.
// ──────────────────────────────────────────────────────────────────────────
describe("HttpSandboxAdapter — fetch timeout (server never responds)", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let baseUrl = "";
	// Track hanging handler resolvers so teardown never leaves a dangling promise.
	const release: Array<() => void> = [];

	beforeAll(() => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				// Never resolve on its own — only the AbortController (client) or
				// teardown should end this request, simulating a hung sandbox.
				return new Promise<Response>((resolve) => {
					release.push(() => resolve(new Response("late")));
				});
			},
		});
		baseUrl = server.url.href.replace(/\/$/, "");
	});

	afterAll(() => {
		for (const fn of release) fn();
		server?.stop(true);
	});

	it("aborts and surfaces a clean timeout error instead of hanging", async () => {
		// Tiny fetchTimeoutMs → the AbortController fires well before any response.
		const adapter = httpSandboxAdapter({ url: baseUrl, fetchTimeoutMs: 150 });
		const started = Date.now();
		const r = await runOnce(adapter);
		const elapsed = Date.now() - started;

		expect(r.ok).toBe(false);
		expect(r.error).toBe("sandbox request timed out after 150ms");
		expect(r.logs).toEqual([]);
		// It actually returned promptly (bounded by the timeout, not the server).
		expect(elapsed).toBeLessThan(5000);
	}, 10_000);
});

// ──────────────────────────────────────────────────────────────────────────
// 2. network failure — a dead port yields a structured "request failed" error.
// ──────────────────────────────────────────────────────────────────────────
describe("HttpSandboxAdapter — network failure (dead port)", () => {
	it("returns a structured error (not an AbortError) when the host is unreachable", async () => {
		// Bind+close a server to obtain a port that is now guaranteed closed.
		const tmp = Bun.serve({ port: 0, fetch: () => new Response("ok") });
		const deadPort = tmp.port;
		tmp.stop(true);

		const adapter = httpSandboxAdapter({
			url: `http://127.0.0.1:${deadPort}`,
			fetchTimeoutMs: 5000,
		});
		const r = await runOnce(adapter);

		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/^sandbox request failed: /);
		// Must NOT be misreported as a timeout — the abort timer never fired.
		expect(r.error).not.toContain("timed out");
		expect(r.logs).toEqual([]);
	}, 10_000);
});

// ──────────────────────────────────────────────────────────────────────────
// 3. non-JSON response — HTML / empty body → "sandbox returned non-JSON".
// ──────────────────────────────────────────────────────────────────────────
describe("HttpSandboxAdapter — non-JSON server response", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let baseUrl = "";
	// Per-test response config (status + body) the stub echoes back.
	let next: { status: number; body: string } = { status: 200, body: "" };

	beforeAll(() => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch() {
				return new Response(next.body, {
					status: next.status,
					headers: { "content-type": "text/html" },
				});
			},
		});
		baseUrl = server.url.href.replace(/\/$/, "");
	});

	afterAll(() => {
		server?.stop(true);
	});

	it("treats an HTML 500 as transport failure without reflecting its body", async () => {
		next = { status: 500, body: "<html><body>Bad Gateway</body></html>" };
		const adapter = httpSandboxAdapter({ url: baseUrl });
		const r = await runOnce(adapter);

		expect(r.ok).toBe(false);
		expect(r.error).toBe("sandbox request failed (HTTP 500)");
		expect(r.error).not.toContain("Bad Gateway");
		expect(r.logs).toEqual([]);
	});

	it("surfaces 'non-JSON (HTTP 200)' for an empty body", async () => {
		next = { status: 200, body: "" };
		const adapter = httpSandboxAdapter({ url: baseUrl });
		const r = await runOnce(adapter);

		expect(r.ok).toBe(false);
		expect(r.error).toContain("sandbox returned non-JSON (HTTP 200)");
		expect(r.logs).toEqual([]);
	});
});

// ──────────────────────────────────────────────────────────────────────────
// 4. URL trailing-slash normalization — POST lands on a single `/run`.
// ──────────────────────────────────────────────────────────────────────────
describe("HttpSandboxAdapter — URL trailing-slash normalization", () => {
	let server: ReturnType<typeof Bun.serve> | undefined;
	let host = "";
	const seenPaths: string[] = [];

	beforeAll(() => {
		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(req) {
				seenPaths.push(new URL(req.url).pathname);
				// A valid JSON result so the adapter parses cleanly (ok path).
				return new Response(
					JSON.stringify({ ok: true, output: 42, logs: [] }),
					{
						headers: { "content-type": "application/json" },
					},
				);
			},
		});
		host = server.url.href.replace(/\/$/, "");
	});

	afterEach(() => {
		seenPaths.length = 0;
	});

	afterAll(() => {
		server?.stop(true);
	});

	it("hits exactly /run when the base url has NO trailing slash", async () => {
		const adapter = httpSandboxAdapter({ url: host });
		const r = await runOnce(adapter);

		expect(r.ok).toBe(true);
		expect(r.output).toBe(42);
		expect(seenPaths).toEqual(["/run"]);
	});

	it("hits exactly /run (not //run) when the base url HAS a trailing slash", async () => {
		const adapter = httpSandboxAdapter({ url: `${host}/` });
		const r = await runOnce(adapter);

		expect(r.ok).toBe(true);
		expect(r.output).toBe(42);
		expect(seenPaths).toEqual(["/run"]);
	});
});

// ──────────────────────────────────────────────────────────────────────────
// 5. custom `fetch` — options.fetch is honored over globalThis.fetch.
// ──────────────────────────────────────────────────────────────────────────
describe("HttpSandboxAdapter — custom fetch option", () => {
	it("uses the injected fetch (with its url + payload) instead of globalThis.fetch", async () => {
		const seen: Array<{
			url: string;
			body: unknown;
			hadSignal: boolean;
			redirect?: RequestRedirect;
		}> = [];
		// A stub fetch that never touches the network — proves the adapter routes
		// through options.fetch and forwards the request it built.
		const customFetch = (async (
			input: RequestInfo | URL,
			init?: RequestInit,
		) => {
			seen.push({
				url: String(input),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
				hadSignal: !!init?.signal,
				redirect: init?.redirect,
			});
			return new Response(
				JSON.stringify({ ok: true, output: "via-custom", logs: [] }),
				{
					headers: { "content-type": "application/json" },
				},
			);
		}) as unknown as typeof fetch;

		const adapter = httpSandboxAdapter({
			url: "http://sandbox.invalid",
			fetch: customFetch,
		});
		const r = await runOnce(adapter, { input: { n: 7 } });

		expect(r.ok).toBe(true);
		expect(r.output).toBe("via-custom");
		expect(seen).toHaveLength(1);
		expect(seen[0]!.url).toBe("http://sandbox.invalid/run");
		// The adapter built the documented JSON body and an abort signal.
		expect((seen[0]!.body as { input: unknown }).input).toEqual({ n: 7 });
		expect((seen[0]!.body as { source: string }).source).toBe(
			"export default async () => 1",
		);
		expect(seen[0]!.hadSignal).toBe(true);
		expect(seen[0]!.redirect).toBe("error");
	});

	it("rejects malformed runtime results instead of coercing their shape", async () => {
		const adapter = httpSandboxAdapter({
			url: "http://sandbox.invalid",
			fetch: (async () =>
				Response.json({
					ok: "yes",
					logs: [],
					extra: "smuggled",
				})) as typeof fetch,
		});
		const result = await runOnce(adapter);

		expect(result).toEqual({
			ok: false,
			error: "sandbox returned an invalid response",
			logs: [],
		});
	});

	it("cancels a streamed response once the hard byte cap is crossed", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				const chunk = new Uint8Array(256 * 1024);
				for (let index = 0; index < 12; index += 1) controller.enqueue(chunk);
			},
			cancel() {
				cancelled = true;
			},
		});
		const adapter = httpSandboxAdapter({
			url: "http://sandbox.invalid",
			fetch: (async () => new Response(body)) as typeof fetch,
		});
		const result = await runOnce(adapter);

		expect(result).toEqual({
			ok: false,
			error: "sandbox returned an invalid response",
			logs: [],
		});
		expect(cancelled).toBe(true);
	});
});

describe("HttpSandboxAdapter — custom-tool session lifecycle", () => {
	it("keeps the envelope host-only and revokes the token when transport settles", async () => {
		let token = "";
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async (_input, init) => {
				const body = JSON.parse(String(init?.body));
				expect(body).not.toHaveProperty("sandboxTools");
				expect(JSON.stringify(body)).not.toContain("consumer-secret");
				token = body.bindings.token;
				expect(token).toMatch(/^[a-f0-9]{64}$/);
				expect(() =>
					registerSandboxCustomToolsSession(
						token,
						"https://app.example/api/sandbox/rpc",
						{},
						1_000,
					),
				).toThrow(/could not be registered/);
				return Response.json({ ok: true, output: 42, logs: [] });
			}) as typeof fetch,
		});

		const result = await runOnce(adapter, {
			brokerUrl: "https://app.example/api/sandbox/rpc",
			sandboxTools: {
				envelope: { opaque: "consumer-secret" },
			},
		});

		expect(result).toMatchObject({ ok: true, output: 42 });
		const replacement = registerSandboxCustomToolsSession(
			token,
			"https://app.example/api/sandbox/rpc",
			{},
			1_000,
		);
		replacement.revoke();
	});

	it("fails closed when tools are requested without broker bindings", async () => {
		let fetches = 0;
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			validateEgress: false,
			fetch: (async () => {
				fetches += 1;
				return Response.json({ ok: true, logs: [] });
			}) as typeof fetch,
		});

		expect(
			await runOnce(adapter, {
				sandboxTools: { envelope: { opaque: true } },
			}),
		).toEqual({
			ok: false,
			error: "sandbox custom tools require broker bindings",
			logs: [],
		});
		expect(fetches).toBe(0);
	});
});

describe("HttpSandboxAdapter — canonical endpoint and redirect pinning", () => {
	it("rejects ambiguous or credential-bearing base URLs before fetch", async () => {
		for (const url of [
			"ftp://sandbox.example",
			"https://user@sandbox.example",
			"https://sandbox.example/#fragment",
			"https://sandbox.example/?tenant=a",
			"https://sandbox.example/api",
			"https://sandbox.example/.",
			"HTTPS://Sandbox.Example",
		]) {
			let fetches = 0;
			const adapter = httpSandboxAdapter({
				url,
				fetch: (async () => {
					fetches += 1;
					return Response.json({ ok: true, output: 1, logs: [] });
				}) as typeof fetch,
			});
			const result = await runOnce(adapter);
			expect(result.ok, url).toBe(false);
			expect(fetches, url).toBe(0);
		}
	});

	it("does not follow a redirect or forward the host credential cross-origin", async () => {
		let leakedCredential: string | null = null;
		const sink = Bun.serve({
			port: 0,
			fetch(request) {
				leakedCredential = request.headers.get(
					"x-questpie-sandbox-host-admission",
				);
				return Response.json({ ok: true, output: "leaked", logs: [] });
			},
		});
		const redirector = Bun.serve({
			port: 0,
			fetch() {
				return Response.redirect(`http://127.0.0.1:${sink.port}/run`, 307);
			},
		});
		try {
			const adapter = httpSandboxAdapter({
				url: `http://127.0.0.1:${redirector.port}`,
				hostAdmissionSecret: "host-secret-must-not-cross-origin",
			});
			const result = await runOnce(adapter);
			expect(result.ok).toBe(false);
			expect(leakedCredential).toBeNull();
		} finally {
			redirector.stop(true);
			sink.stop(true);
		}
	});

	it("treats every non-2xx response as transport failure despite an ok:true body", async () => {
		const adapter = httpSandboxAdapter({
			url: "https://sandbox.example",
			fetch: (async () =>
				Response.json(
					{ ok: true, output: "must-not-pass", logs: [] },
					{ status: 403 },
				)) as typeof fetch,
		});
		expect(await runOnce(adapter)).toEqual({
			ok: false,
			error: "sandbox request failed (HTTP 403)",
			logs: [],
		});
	});
});
