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

import { BROKER_TOTAL_OUTPUT_CAP_BYTES } from "../src/broker-wire.js";
import {
	sealSandboxWorkloadAdmission,
	type SandboxWorkloadAdmissionKey,
} from "../src/workload-admission.js";

const denoPath = Bun.which("deno");
const SERVER_ENTRY = new URL("../src/sandbox-server.ts", import.meta.url)
	.pathname;
const HOST_SECRET = "questpie-sandbox-host-service-key-32-bytes-minimum";
const WORKLOAD_SECRET = "questpie-sandbox-workload-admission-secret-32-bytes";
const INSTANCE_ID = "sandbox_instance_test";
const WORKLOAD_KEY: SandboxWorkloadAdmissionKey = {
	keyId: "sandbox-workload-v1",
	secret: new TextEncoder().encode(WORKLOAD_SECRET),
	instanceId: INSTANCE_ID,
};

let denoProc: ReturnType<typeof Bun.spawn> | undefined;
let sandboxUrl = "";
let brokerServer: ReturnType<typeof Bun.serve> | undefined;
let redirectSink: ReturnType<typeof Bun.serve> | undefined;
let brokerUrl = "";
let brokerCalls = 0;
let brokerResponseMode: "ok" | "slow_ok" | "invalid" | "denied" | "redirect" =
	"ok";
let redirectSinkCalls = 0;
let redirectedToken: string | null = null;

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

	redirectSink = Bun.serve({
		port: 0,
		fetch(request) {
			redirectSinkCalls += 1;
			redirectedToken = request.headers.get("x-questpie-sandbox-token");
			return Response.json({ ok: true, value: "credential leaked" });
		},
	});
	brokerServer = Bun.serve({
		port: 0,
		fetch: async () => {
			brokerCalls += 1;
			if (brokerResponseMode === "invalid") {
				return new Response("private upstream diagnostics".repeat(50_000), {
					status: 502,
				});
			}
			if (brokerResponseMode === "denied") {
				return Response.json({
					ok: false,
					error: {
						code: "forbidden",
						message: "raw tenant and policy diagnostics",
					},
				});
			}
			if (brokerResponseMode === "redirect") {
				return Response.redirect(
					`http://127.0.0.1:${redirectSink!.port}/stolen`,
					307,
				);
			}
			if (brokerResponseMode === "slow_ok") await Bun.sleep(250);
			return Response.json({ ok: true, value: [] });
		},
	});
	brokerUrl = `http://127.0.0.1:${brokerServer.port}/sandbox/rpc?channel=canonical`;
	denoProc = Bun.spawn(
		[
			denoPath as string,
			"run",
			"--allow-net",
			"--allow-env",
			"--allow-run",
			"--allow-read",
			"--allow-write",
			SERVER_ENTRY,
		],
		{
			env: {
				...process.env,
				PORT: "0",
				SANDBOX_HOST_ADMISSION_SECRET: HOST_SECRET,
				SANDBOX_WORKLOAD_ADMISSION_SECRET: WORKLOAD_SECRET,
				SANDBOX_WORKLOAD_ADMISSION_KEY_ID: WORKLOAD_KEY.keyId,
				SANDBOX_INSTANCE_ID: INSTANCE_ID,
				SANDBOX_BROKER_URL: brokerUrl,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const port = await waitForListen(denoProc);
	sandboxUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
	denoProc?.kill();
	await denoProc?.exited;
	brokerServer?.stop(true);
	redirectSink?.stop(true);
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
	return fetch(`${sandboxUrl}/run`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-questpie-sandbox-host-admission": HOST_SECRET,
		},
		body: JSON.stringify({ mode: "host", ...(body as object) }),
	});
}

function workloadBody(source = "export default async () => 42") {
	return JSON.stringify({
		mode: "workload",
		source,
		input: null,
		capabilities: { net: [], import: [], timeoutMs: 5_000, memoryMb: 128 },
		secrets: {},
	});
}

async function postWorkload(
	body: string,
	admission?: string,
	signal?: AbortSignal,
) {
	return fetch(`${sandboxUrl}/run`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(admission ? { "x-questpie-workload-admission": admission } : {}),
		},
		body,
		signal,
	});
}

async function waitForBrokerCall(attemptsRemaining = 200): Promise<void> {
	if (brokerCalls > 0 || attemptsRemaining <= 0) return;
	await Bun.sleep(10);
	return waitForBrokerCall(attemptsRemaining - 1);
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
		expect(body.error).toBe("invalid sandbox request");
	});

	it("POST /run missing 'capabilities' → 400", async () => {
		// source present, capabilities absent → fails the capabilities check.
		const res = await postRun({
			source: "export default async () => 1",
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toBe("invalid sandbox request");
	});

	it("rejects extra keys, malformed limits, and over-deep input before spawn", async () => {
		let deepInput: Record<string, unknown> = {};
		for (let depth = 0; depth < 40; depth += 1) {
			deepInput = { nested: deepInput };
		}
		for (const body of [
			{
				source: "export default async () => 1",
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				unexpected: true,
			},
			{
				source: "export default async () => 1",
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: "5000",
					memoryMb: 128,
				},
			},
			{
				source: "export default async () => 1",
				input: deepInput,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
			},
		]) {
			const response = await postRun(body);
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				ok: false,
				error: "invalid sandbox request",
				logs: [],
			});
		}
	}, 20_000);

	it("refuses to start workload admission without a unique process instance", async () => {
		const process = Bun.spawn(
			[
				denoPath as string,
				"run",
				"--allow-net",
				"--allow-env",
				"--allow-run",
				"--allow-read",
				"--allow-write",
				SERVER_ENTRY,
			],
			{
				env: {
					...globalThis.process.env,
					PORT: "0",
					SANDBOX_WORKLOAD_ADMISSION_SECRET: WORKLOAD_SECRET,
					SANDBOX_WORKLOAD_ADMISSION_KEY_ID: WORKLOAD_KEY.keyId,
					SANDBOX_INSTANCE_ID: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const exitCode = await process.exited;
		const stderr = await new Response(process.stderr).text();

		expect(exitCode).not.toBe(0);
		expect(stderr).toContain(
			"Invalid sandbox workload admission configuration.",
		);
	}, 20_000);

	it("unknown route → 404 { ok:false, error:'not found' }", async () => {
		const res = await fetch(`${sandboxUrl}/nope`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as { ok: boolean; error: string };
		expect(body.ok).toBe(false);
		expect(body.error).toBe("not found");
	});
});

describe.if(!!denoPath)("sandbox-server — generic workload admission", () => {
	it("fails closed when admission is missing or body-bound policy is widened", async () => {
		const body = workloadBody();
		expect((await postWorkload(body)).status).toBe(403);

		const admission = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: INSTANCE_ID,
				expiresAt: new Date(Date.now() + 4_000).toISOString(),
			},
			body,
		);
		const widened = body.replace('"net":[]', '"net":["attacker.example:443"]');
		expect((await postWorkload(widened, admission)).status).toBe(403);
	}, 20_000);

	it("executes once and rejects replay of the same admission", async () => {
		const body = workloadBody();
		const admission = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: INSTANCE_ID,
				expiresAt: new Date(Date.now() + 4_000).toISOString(),
			},
			body,
		);

		const first = await postWorkload(body, admission);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual(
			expect.objectContaining({ ok: true, output: 42 }),
		);
		expect((await postWorkload(body, admission)).status).toBe(403);
	}, 20_000);

	it("kills a dispatched guest on caller cancellation before a delayed effect", async () => {
		brokerCalls = 0;
		const body = JSON.stringify({
			mode: "workload",
			source: `export default async () => {
				await questpie.collections.posts.find({});
				await new Promise((resolve) => setTimeout(resolve, 500));
				await questpie.collections.posts.find({});
			}`,
			input: null,
			capabilities: {
				net: [],
				import: [],
				timeoutMs: 5_000,
				memoryMb: 128,
			},
			secrets: {},
			bindings: { url: brokerUrl, token: "scoped-test-token" },
		});
		const admission = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: INSTANCE_ID,
				expiresAt: new Date(Date.now() + 4_000).toISOString(),
			},
			body,
		);
		const controller = new AbortController();
		const request = postWorkload(body, admission, controller.signal).catch(
			() => undefined,
		);
		await waitForBrokerCall();
		expect(brokerCalls).toBe(1);

		controller.abort();
		await request;
		await Bun.sleep(700);

		expect(brokerCalls).toBe(1);
	}, 20_000);

	it("rejects forged, expired, and wrong-instance admissions without spawning", async () => {
		const effectBody = JSON.stringify({
			mode: "workload",
			source: "export default async () => questpie.collections.posts.find({})",
			input: null,
			capabilities: {
				net: [],
				import: [],
				timeoutMs: 5_000,
				memoryMb: 128,
			},
			secrets: {},
			bindings: { url: brokerUrl, token: "scoped-test-token" },
		});
		const expired = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: INSTANCE_ID,
				expiresAt: new Date(Date.now() - 1).toISOString(),
			},
			effectBody,
		);
		const wrongInstance = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: "sandbox_instance_other",
				expiresAt: new Date(Date.now() + 4_000).toISOString(),
			},
			effectBody,
		);

		for (const candidate of ["forged", expired, wrongInstance]) {
			brokerCalls = 0;
			const response = await postWorkload(effectBody, candidate);
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({
				ok: false,
				error: "The workload is not authorized for this sandbox operation.",
				logs: [],
			});
			await Bun.sleep(50);
			expect(brokerCalls).toBe(0);
		}
	}, 20_000);

	it("does not downgrade unknown or omitted modes and rejects host auth failure", async () => {
		const execution = {
			source: "export default async () => 1",
			input: null,
			capabilities: {
				net: [],
				import: [],
				timeoutMs: 5_000,
				memoryMb: 128,
			},
			secrets: {},
		};
		for (const body of [{ ...execution }, { mode: "unknown", ...execution }]) {
			const response = await postRaw(JSON.stringify(body));
			expect(response.status).toBe(403);
		}
		const hostResponse = await fetch(`${sandboxUrl}/run`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ mode: "host", ...execution }),
		});
		expect(hostResponse.status).toBe(403);
		expect(await hostResponse.json()).toEqual({
			ok: false,
			error: "The workload is not authorized for this sandbox operation.",
			logs: [],
		});
	}, 20_000);

	it("pins the broker query exactly and rejects fragments before relay", async () => {
		for (const url of [
			brokerUrl.replace("channel=canonical", "channel=other"),
			`${brokerUrl}#fragment`,
		]) {
			brokerCalls = 0;
			const response = await postRun({
				source:
					"export default async () => globalThis.questpie.collections.posts.find({})",
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				bindings: { url, token: "opaque-test-token" },
			});
			const result = await response.json();
			expect(result.ok).toBe(false);
			expect(result.error).toContain("bindings rejected");
			expect(brokerCalls).toBe(0);
		}
	}, 20_000);

	it("does not expose subprocess stderr on the workload transport", async () => {
		const body = workloadBody("this is not valid TypeScript }");
		const admission = await sealSandboxWorkloadAdmission(
			WORKLOAD_KEY,
			{
				kind: "sandbox_workload_admission",
				version: 1,
				admissionId: crypto.randomUUID(),
				supervisorInstanceId: INSTANCE_ID,
				expiresAt: new Date(Date.now() + 4_000).toISOString(),
			},
			body,
		);

		const response = await postWorkload(body, admission);
		const result = (await response.json()) as {
			ok: boolean;
			error?: string;
			logs: string[];
		};

		expect(response.status).toBe(200);
		expect(result).toEqual({
			ok: false,
			error: "sandbox execution failed",
			logs: [],
			ms: expect.any(Number),
		});
		expect(JSON.stringify(result)).not.toContain("TypeScript");
	}, 20_000);

	it("latches a malformed broker response before workload catch can succeed", async () => {
		brokerResponseMode = "invalid";
		try {
			const body = JSON.stringify({
				mode: "workload",
				source: `export default async () => {
					try {
						await globalThis.questpie.collections.posts.find({});
						return "unexpected success";
					} catch (error) {
						return error instanceof Error ? error.message : String(error);
					}
				}`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				secrets: {},
				bindings: { url: brokerUrl, token: "opaque-test-token" },
			});
			const admission = await sealSandboxWorkloadAdmission(
				WORKLOAD_KEY,
				{
					kind: "sandbox_workload_admission",
					version: 1,
					admissionId: crypto.randomUUID(),
					supervisorInstanceId: INSTANCE_ID,
					expiresAt: new Date(Date.now() + 4_000).toISOString(),
				},
				body,
			);

			const response = await postWorkload(body, admission);
			const result = (await response.json()) as {
				ok: boolean;
				output?: unknown;
			};
			expect(result.ok).toBe(false);
			expect(result.output).toBeUndefined();
			expect((result as { error?: string }).error).toBe(
				"sandbox execution failed",
			);
			expect(JSON.stringify(result)).not.toContain(
				"private upstream diagnostics",
			);
		} finally {
			brokerResponseMode = "ok";
		}
	}, 20_000);

	it("latches a valid broker denial before workload catch can succeed", async () => {
		brokerResponseMode = "denied";
		try {
			const body = JSON.stringify({
				mode: "workload",
				source: `export default async () => {
					try {
						await globalThis.questpie.collections.posts.find({});
						return "unexpected success";
					} catch (error) {
						return error instanceof Error ? error.message : String(error);
					}
				}`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				secrets: {},
				bindings: { url: brokerUrl, token: "opaque-test-token" },
			});
			const admission = await sealSandboxWorkloadAdmission(
				WORKLOAD_KEY,
				{
					kind: "sandbox_workload_admission",
					version: 1,
					admissionId: crypto.randomUUID(),
					supervisorInstanceId: INSTANCE_ID,
					expiresAt: new Date(Date.now() + 4_000).toISOString(),
				},
				body,
			);

			const result = await (await postWorkload(body, admission)).json();
			expect(result.ok).toBe(false);
			expect(result.output).toBeUndefined();
			expect(result.error).toBe("sandbox execution failed");
			expect(JSON.stringify(result)).not.toContain(
				"raw tenant and policy diagnostics",
			);
		} finally {
			brokerResponseMode = "ok";
		}
	}, 20_000);

	it("never follows a broker redirect or forwards the binding token", async () => {
		brokerResponseMode = "redirect";
		redirectSinkCalls = 0;
		redirectedToken = null;
		try {
			const response = await postRun({
				source: `export default async () => {
					try {
						await globalThis.questpie.collections.posts.find({});
						return "unexpected success";
					} catch {
						return "caught";
					}
				}`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				bindings: { url: brokerUrl, token: "must-not-leak" },
			});
			const result = await response.json();
			expect(result.ok).toBe(false);
			expect(result.output).toBeUndefined();
			expect(result.error).toBe("sandbox broker request failed");
			expect(redirectSinkCalls).toBe(0);
			expect(redirectedToken).toBeNull();
		} finally {
			brokerResponseMode = "ok";
		}
	}, 20_000);
});

describe.if(!!denoPath)(
	"sandbox-server — legacy compute path (no bindings)",
	() => {
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

		it("uses a virtual /work cwd with no HOME or ambient environment", async () => {
			const res = await postRun({
				source: `export default async () => {
				let home = "ambient";
				try { home = Deno.env.get("HOME") ?? "missing"; } catch { home = "denied"; }
				return { cwd: Deno.cwd(), home };
			}`,
				input: null,
				capabilities: { net: [], import: [], timeoutMs: 8000, memoryMb: 128 },
			});
			const body = (await res.json()) as { ok: boolean; output?: unknown };

			expect(body.ok).toBe(true);
			expect(body.output).toEqual({ cwd: "/work", home: "denied" });
		}, 20_000);

		it("denies the complete generic capability matrix and preserves stable process surfaces", async () => {
			const deniedCases = [
				["read", `await Deno.readTextFile("/etc/passwd")`],
				["write", `await Deno.writeTextFile("/tmp/qp-denied", "x")`],
				["env-all", `Deno.env.toObject()`],
				["run", `await new Deno.Command("true").output()`],
				["ffi", `Deno.dlopen("/tmp/missing.so", {})`],
				["sys", `Deno.hostname()`],
				["import-deno-land", `await import("https://deno.land/blocked.ts")`],
				["import-jsr", `await import("https://jsr.io/blocked.ts")`],
				["import-esm", `await import("https://esm.sh/blocked")`],
				["import-raw-esm", `await import("https://raw.esm.sh/blocked")`],
				[
					"import-jsdelivr",
					`await import("https://cdn.jsdelivr.net/blocked.js")`,
				],
				[
					"import-github",
					`await import("https://raw.githubusercontent.com/blocked.ts")`,
				],
				[
					"import-gist",
					`await import("https://gist.githubusercontent.com/blocked.ts")`,
				],
			] as const;
			for (const [name, operation] of deniedCases) {
				const response = await postRun({
					source: `export default async () => {
						try {
							${operation};
							return "allowed";
						} catch {
							return "denied";
						}
					}`,
					input: null,
					capabilities: {
						net: [],
						import: [],
						timeoutMs: 5_000,
						memoryMb: 128,
					},
				});
				const result = await response.json();
				expect(result.output, name).toBe("denied");
			}

			const globals = await postRun({
				source: `export default async () => ({
					worker: typeof Worker,
					sharedArrayBuffer: typeof SharedArrayBuffer,
					atomics: typeof Atomics,
				})`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
			});
			expect((await globals.json()).output).toEqual({
				worker: "undefined",
				sharedArrayBuffer: "undefined",
				atomics: "undefined",
			});

			const processSurface = await postRun({
				source: `export default async () => {
					const process = (await import("node:process")).default;
					let env;
					try {
						env = Object.fromEntries(Object.entries(process.env));
					} catch {
						env = "denied";
					}
					return {
						argv: process.argv,
						execPath: process.execPath,
						cwd: process.cwd(),
						env,
					};
				}`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
			});
			const processResult = await processSurface.json();
			expect(processResult.ok, JSON.stringify(processResult)).toBe(true);
			expect(processResult.output).toEqual({
				argv: ["deno", "questpie://sandbox/guest-entry.ts"],
				execPath: "/runtime/deno",
				cwd: "/work",
				env: "denied",
			});

			const health = await fetch(`${sandboxUrl}/health`);
			expect(health.status).toBe(200);
			expect((await health.json()).ok).toBe(true);
		}, 30_000);
	},
);

describe.if(!!denoPath)("sandbox-server — resource bounds", () => {
	it("kills an output bomb and remains healthy", async () => {
		const response = await postRun({
			source: `export default async () => 'x'.repeat(${BROKER_TOTAL_OUTPUT_CAP_BYTES + 1024})`,
			input: null,
			capabilities: { net: [], import: [], timeoutMs: 8_000, memoryMb: 128 },
		});
		const result = await response.json();
		expect(result.ok).toBe(false);
		expect(result.error).toBe("sandbox output limit exceeded");

		const health = await fetch(`${sandboxUrl}/health`);
		expect(health.status).toBe(200);
		expect((await health.json()).ok).toBe(true);
	}, 20_000);

	it("kills a stderr bomb at its independent per-run cap", async () => {
		const response = await postRun({
			source: `export default async () => {
				await Deno.stderr.write(new Uint8Array(300 * 1024));
				return "unexpected";
			}`,
			input: null,
			capabilities: { net: [], import: [], timeoutMs: 8_000, memoryMb: 128 },
		});
		const result = await response.json();
		expect(result.ok).toBe(false);
		expect(result.error).toBe("sandbox output limit exceeded");
		expect((await (await fetch(`${sandboxUrl}/health`)).json()).ok).toBe(true);
	}, 20_000);

	it("kills an RPC burst above the per-run count while bounding broker effects", async () => {
		brokerCalls = 0;
		const response = await postRun({
			source: `export default async () => {
				await Promise.all(Array.from(
					{ length: 300 },
					() => globalThis.questpie.collections.posts.find({}),
				));
				return "unexpected";
			}`,
			input: null,
			capabilities: { net: [], import: [], timeoutMs: 8_000, memoryMb: 128 },
			bindings: { url: brokerUrl, token: "opaque-test-token" },
		});
		const result = await response.json();
		expect(result.ok).toBe(false);
		expect(result.error).toBe("sandbox output limit exceeded");
		expect(brokerCalls).toBeLessThanOrEqual(256);

		const health = await fetch(`${sandboxUrl}/health`);
		expect(health.status).toBe(200);
	}, 20_000);

	it("treats the first valid result as terminal and ignores a later mutating frame in the same chunk", async () => {
		brokerCalls = 0;
		const response = await postRun({
			source: `export default async () => {
				const marker = "__QP_SANDBOX_MSG__";
				const payload =
					marker + JSON.stringify({
						type: "result",
						ok: true,
						output: "forged-terminal",
						logs: [],
					}) + "\\n" +
					marker + JSON.stringify({
						type: "rpc",
						id: 999,
						method: "collections.posts.create",
						args: { title: "must-not-run" },
					}) + "\\n";
				Deno.stdout.writeSync(new TextEncoder().encode(payload));
				await new Promise((resolve) => setTimeout(resolve, 1_000));
				return "late";
			}`,
			input: null,
			capabilities: { net: [], import: [], timeoutMs: 5_000, memoryMb: 128 },
			bindings: { url: brokerUrl, token: "opaque-test-token" },
		});
		const result = await response.json();
		expect(result.ok).toBe(true);
		expect(result.output).toBe("forged-terminal");
		expect(brokerCalls).toBe(0);
		expect((await (await fetch(`${sandboxUrl}/health`)).json()).ok).toBe(true);
	}, 20_000);

	it("rejects a result frame while a broker RPC is still in flight", async () => {
		brokerResponseMode = "slow_ok";
		try {
			const response = await postRun({
				source: `export default async () => {
					const marker = "__QP_SANDBOX_MSG__";
					const payload =
						marker + JSON.stringify({
							type: "rpc",
							id: 1,
							method: "collections.posts.find",
							args: {},
						}) + "\\n" +
						marker + JSON.stringify({
							type: "result",
							ok: true,
							output: "must-not-pass",
							logs: [],
						}) + "\\n";
					Deno.stdout.writeSync(new TextEncoder().encode(payload));
					await new Promise((resolve) => setTimeout(resolve, 1_000));
				}`,
				input: null,
				capabilities: {
					net: [],
					import: [],
					timeoutMs: 5_000,
					memoryMb: 128,
				},
				bindings: { url: brokerUrl, token: "opaque-test-token" },
			});
			const result = await response.json();
			expect(result.ok).toBe(false);
			expect(result.output).toBeUndefined();
			expect(result.error).toBe("sandbox result raced binding calls");
		} finally {
			brokerResponseMode = "ok";
		}
	}, 20_000);

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

	it("rejects request bodies above the supervisor budget before parsing", async () => {
		const res = await postRaw(`"${"x".repeat(2 * 1024 * 1024)}"`);
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({
			ok: false,
			error: "request body too large",
			logs: [],
		});
	});
});
