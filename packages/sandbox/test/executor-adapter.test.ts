import { describe, expect, it } from "bun:test";

import { ExecutorService } from "questpie/executor";

import { httpSandboxAdapter } from "../src/adapter-http.js";

/**
 * Integration tests for the core `executor` adapter dispatch.
 *
 * The TRUSTED in-process path runs unconditionally (no external deps). The
 * SANDBOXED path requires a running `sandbox-server.ts`; set `SANDBOX_URL` to
 * enable those cases (e.g.
 *   PORT=8811 deno run --allow-net --allow-env --allow-run --allow-read \
 *     src/sandbox-server.ts
 *   SANDBOX_URL=http://localhost:8811 bun test
 * ). When unset, the sandboxed cases are skipped, not failed.
 */
const SANDBOX_URL = process.env.SANDBOX_URL;

describe("ExecutorService — configuration gating", () => {
	it("throws when the executor is not configured at all", async () => {
		const svc = new ExecutorService(undefined);
		expect(svc.isEnabled).toBe(false);
		await expect(
			svc.run({ source: "export default async()=>1" }),
		).rejects.toThrow(/not configured/);
	});

	it("throws on sandboxed run when no sandboxed adapter is configured", async () => {
		const svc = new ExecutorService({}); // trusted-only
		expect(svc.isEnabled).toBe(true);
		await expect(
			svc.run({ source: "export default async()=>1", isolation: "sandboxed" }),
		).rejects.toThrow(/sandboxed isolation is not configured/);
	});
});

describe("ExecutorService — trusted (in-process)", () => {
	const svc = new ExecutorService({});

	it("round-trips input → output", async () => {
		const r = await svc.run({
			source: "export default async (input) => ({ doubled: input.n * 2 })",
			input: { n: 21 },
			isolation: "trusted",
		});
		expect(r.ok).toBe(true);
		expect(r.output).toEqual({ doubled: 42 });
	});

	it("captures console logs", async () => {
		const r = await svc.run({
			source:
				"export default async () => { console.log('hi', { a: 1 }); return 1; }",
			isolation: "trusted",
		});
		expect(r.ok).toBe(true);
		expect(r.logs).toContain('log: hi {"a":1}');
	});

	it("returns a structured error on guest throw", async () => {
		const r = await svc.run({
			source: "export default async () => { throw new Error('boom'); }",
			isolation: "trusted",
		});
		expect(r.ok).toBe(false);
		expect(r.error).toBe("boom");
	});

	it("rejects a guest that does not export a function", async () => {
		const r = await svc.run({
			source: "export const notDefault = 1;",
			isolation: "trusted",
		});
		expect(r.ok).toBe(false);
		expect(r.error).toContain("export default");
	});

	it("enforces a soft timeout on async work", async () => {
		const r = await svc.run({
			source:
				"export default async () => { await new Promise(r => setTimeout(r, 5000)); return 1; }",
			isolation: "trusted",
			capabilities: { timeoutMs: 200 },
		});
		expect(r.ok).toBe(false);
		expect(r.timedOut).toBe(true);
	});

	it("exposes injected secrets as globalThis.__secrets", async () => {
		const r = await svc.run({
			source: "export default async () => globalThis.__secrets?.token",
			isolation: "trusted",
			secrets: { token: "s3cr3t" },
		});
		expect(r.ok).toBe(true);
		expect(r.output).toBe("s3cr3t");
	});
});

describe.if(!!SANDBOX_URL)(
	"ExecutorService — sandboxed (HTTP → Deno service)",
	() => {
		const svc = new ExecutorService({
			sandboxed: httpSandboxAdapter({
				url: SANDBOX_URL,
				hostAdmissionSecret: process.env.SANDBOX_HOST_ADMISSION_SECRET,
			}),
		});
		const baseCaps = { net: [], import: [], timeoutMs: 5000, memoryMb: 128 };

		it("round-trips input → output via the sandbox", async () => {
			const r = await svc.run({
				source: "export default async (input) => ({ tripled: input.n * 3 })",
				input: { n: 7 },
				isolation: "sandboxed",
				capabilities: baseCaps,
			});
			expect(r.ok).toBe(true);
			expect(r.output).toEqual({ tripled: 21 });
		});

		it("defaults isolation to sandboxed", async () => {
			const r = await svc.run({
				source: "export default async () => ({ defaultIso: true })",
				capabilities: baseCaps,
			});
			expect(r.ok).toBe(true);
			expect(r.output).toEqual({ defaultIso: true });
		});

		it("blocks a private-IP egress host before spawn", async () => {
			const r = await svc.run({
				source: "export default async () => 1",
				isolation: "sandboxed",
				capabilities: { ...baseCaps, net: ["169.254.169.254:80"] },
			});
			expect(r.ok).toBe(false);
			expect(r.error).toContain("egress blocked");
		});

		it("bounds a memory bomb to its own subprocess (service survives)", async () => {
			const bomb = svc.run({
				source:
					"export default async () => { const a = []; while (true) { a.push(new Array(1e6).fill(1)); } }",
				isolation: "sandboxed",
				capabilities: { net: [], import: [], timeoutMs: 30000, memoryMb: 64 },
			});
			const benign = svc.run({
				source: "export default async () => ({ benign: true })",
				isolation: "sandboxed",
				capabilities: baseCaps,
			});
			const [bombResult, benignResult] = await Promise.all([bomb, benign]);
			// The bomb dies in its own process (structured failure, not a service crash).
			expect(bombResult.ok).toBe(false);
			// A concurrent benign request is unaffected.
			expect(benignResult.ok).toBe(true);
			expect(benignResult.output).toEqual({ benign: true });
		});
	},
);
