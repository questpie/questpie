/**
 * HTTP-API tests against the REAL Deno sandbox supervisor (`sandbox-server.ts`).
 *
 * Unlike the adapter-level tests, these exercise the raw HTTP surface directly
 * with `fetch` — status codes and exact response bodies that the
 * `httpSandboxAdapter` deliberately abstracts away (it collapses every non-2xx
 * into `{ ok:false, error }` and always sends client-validated capabilities).
 *
 * Spawns ONE shared supervisor on an ephemeral port (the beforeAll/afterAll +
 * waitForListen pattern is modeled on `bindings-e2e.test.ts`). Requires `deno`
 * on PATH; guarded with `describe.if(!!Bun.which("deno"))` so CI without Deno
 * stays green.
 *
 * Covers:
 *   - GET  /health                        → { ok:true, runtime:"deno", ... }
 *   - POST /run  (invalid-JSON body)      → 400 { ok:false, error:"invalid JSON body" }
 *   - POST /run  (missing source)         → 400
 *   - POST /run  (missing capabilities)   → 400
 *   - unknown route                       → 404 { ok:false, error:"not found" }
 *   - POST /run  LEGACY compute path (source+capabilities, NO bindings)
 *                                         → ok:true, output returned, console.log in logs
 *   - POST /run  explicit wall-timeout (tiny timeoutMs + infinite loop)
 *                                         → ok:false, timedOut:true
 *   - POST /run  memory-cap smoke (low memoryMb + allocation bomb)
 *                                         → ok:false, AND the service still answers /health
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

const denoPath = Bun.which("deno");
const SERVER_ENTRY = new URL("../src/sandbox-server.ts", import.meta.url)
	.pathname;

let denoProc: ReturnType<typeof Bun.spawn> | undefined;
let sandboxUrl = "";

async function waitForListen(
	proc: ReturnType<typeof Bun.spawn>,
): Promise<number> {
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	const deadline = Date.now() + 15_000;
	let buf = "";
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const m = buf.match(/listening on :(\d+)/);
		if (m) {
			reader.releaseLock();
			return Number(m[1]);
		}
	}
	reader.releaseLock();
	throw new Error(`sandbox-server did not start; output:\n${buf}`);
}

beforeAll(async () => {
	if (!denoPath) return;

	denoProc = Bun.spawn(
		[
			denoPath as string,
			"run",
			"--allow-net",
			"--allow-env",
			"--allow-run",
			"--allow-read",
			SERVER_ENTRY,
		],
		{ env: { ...process.env, PORT: "0" }, stdout: "pipe", stderr: "pipe" },
	);
	const port = await waitForListen(denoProc);
	sandboxUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	denoProc?.kill();
	await denoProc?.exited;
});

/** POST a RAW string body to /run (so we can hand it malformed/partial JSON). */
function postRaw(body: string) {
	return fetch(`${sandboxUrl}/run`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	});
}

/** POST a JSON object to /run. */
function postRun(body: unknown) {
	return postRaw(JSON.stringify(body));
}

describe.if(!!denoPath)("sandbox-server — HTTP API surface", () => {
	it("GET /health → { ok:true, runtime:'deno', version }", async () => {
		const res = await fetch(`${sandboxUrl}/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			runtime: string;
			version?: string;
		};
		expect(body.ok).toBe(true);
		expect(body.runtime).toBe("deno");
		// version is Deno.version.deno — present, non-empty.
		expect(typeof body.version).toBe("string");
		expect(body.version!.length).toBeGreaterThan(0);
	});

	it("POST /run with an invalid JSON body → 400 { ok:false, error:'invalid JSON body' }", async () => {
		const res = await postRaw("{ this is : not json ]");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toBe("invalid JSON body");
	});

	it("POST /run missing 'source' → 400", async () => {
		// capabilities present, source absent → fails the source typecheck.
		const res = await postRun({
			capabilities: { net: [], import: [], timeoutMs: 5000, memoryMb: 128 },
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toContain("source");
	});

	it("POST /run missing 'capabilities' → 400", async () => {
		// source present, capabilities absent → fails the capabilities check.
		const res = await postRun({
			source: "export default async () => 1",
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toContain("capabilities");
	});

	it("unknown route → 404 { ok:false, error:'not found' }", async () => {
		const res = await fetch(`${sandboxUrl}/nope`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toBe("not found");
	});
});

describe.if(!!denoPath)("sandbox-server — legacy compute path (no bindings)", () => {
	it("runs source, returns the computed output and captures console.log", async () => {
		const res = await postRun({
			source:
				"export default async (input) => { console.log('hi', { a: 1 }); return { doubled: input.n * 2 }; }",
			input: { n: 21 },
			capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
			// NO `bindings` key → the legacy compute-only path (one envelope in,
			// one result line out).
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			ok: boolean;
			output?: unknown;
			logs: string[];
		};
		expect(body.ok).toBe(true);
		expect(body.output).toEqual({ doubled: 42 });
		expect(body.logs).toContain('log: hi {"a":1}');
	}, 20_000);
});

describe.if(!!denoPath)("sandbox-server — resource bounds", () => {
	it("enforces the wall-timeout: a tiny timeoutMs kills an infinite loop", async () => {
		const res = await postRun({
			source: "export default async () => { while (true) {} }",
			input: null,
			// Tiny wall-time; the guest never yields → SIGTERM/SIGKILL fires.
			capabilities: { net: [], import: [], timeoutMs: 300, memoryMb: 128 },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean; timedOut?: boolean };
		expect(body.ok).toBe(false);
		expect(body.timedOut).toBe(true);
	}, 20_000);

	it("bounds a memory bomb to its subprocess; the service still answers /health", async () => {
		const res = await postRun({
			source:
				"export default async () => { const a = []; while (true) { a.push(new Array(1e6).fill(1)); } }",
			input: null,
			// Low per-guest heap cap (--max-old-space-size) → the guest OOMs in its
			// OWN process. Generous wall-time so the failure is the memory cap, not
			// the timeout.
			capabilities: { net: [], import: [], timeoutMs: 20000, memoryMb: 32 },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean };
		// The bomb dies in its own subprocess → structured failure, not a crash.
		expect(body.ok).toBe(false);

		// The SUPERVISOR survived: a follow-up request is served normally.
		const health = await fetch(`${sandboxUrl}/health`);
		expect(health.status).toBe(200);
		expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
	}, 30_000);
});
