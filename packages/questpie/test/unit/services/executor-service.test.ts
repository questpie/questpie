/**
 * Executor service wiring + dispatch.
 *
 * Verifies the core `executor` primitive: it resolves on `ctx.executor`, is
 * DISABLED when unconfigured (opt-in), and dispatches the trusted in-process
 * path. The sandboxed path (process-per-request Deno) is covered by the
 * `@questpie/sandbox` package's integration tests against a live server.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { extractAppServices } from "#questpie/server/config/app-context.js";
import { ExecutorService } from "#questpie/server/modules/core/integrated/executor/service.js";
import { collection } from "../../../src/exports/index.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../../utils/test-db";

describe("executor service wiring", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				items: collection("items").fields(({ f }) => ({
					name: f.text(100).required(),
				})),
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("resolves app.executor as an ExecutorService (infra service)", () => {
		expect(setup.app.executor).toBeInstanceOf(ExecutorService);
	});

	it("projects executor onto the AppContext (parallel to kv)", () => {
		// extractAppServices is the runtime service-projection used by the
		// generated createContext — executor must surface here like kv/storage.
		const ctx = extractAppServices(setup.app);
		expect((ctx as { executor: unknown }).executor).toBeInstanceOf(
			ExecutorService,
		);
		expect((ctx as { executor: unknown }).executor).toBe(setup.app.executor);
	});

	it("is disabled when executor is not configured (opt-in)", async () => {
		expect(setup.app.executor.isEnabled).toBe(false);
		await expect(
			setup.app.executor.run({ source: "export default async () => 1" }),
		).rejects.toThrow(/not configured/);
	});
});

describe("ExecutorService — trusted dispatch (unit, no app)", () => {
	it("runs a trusted in-process script and returns structured output", async () => {
		const svc = new ExecutorService({});
		const r = await svc.run({
			source: "export default async (input) => ({ sum: input.a + input.b })",
			input: { a: 2, b: 3 },
			isolation: "trusted",
		});
		expect(r.ok).toBe(true);
		expect(r.output).toEqual({ sum: 5 });
	});
});

// The trusted in-process adapter imports the guest as a `data:text/typescript`
// module, which only Bun executes natively — so this suite (run under `bun test`)
// is Bun-only. It is skipped elsewhere for parity with the run-code-tool suite.
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

describe.skipIf(!isBun)(
	"ExecutorService — trusted in-process concurrency (mutex)",
	() => {
		// A guest that (1) reads its injected binding + secret, (2) yields across
		// several macrotasks so two overlapping runs' critical sections interleave,
		// then (3) reads them AGAIN. If the trusted runs were NOT serialized, the
		// second run would overwrite `globalThis.questpie` / `__secrets` while the
		// first is parked at a yield, so the first run's second read (and its "end"
		// log) would observe the OTHER run's marker.
		const guest = [
			"export default async function () {",
			"  const read = () => ({",
			"    binding: globalThis.questpie.marker,",
			"    secret: globalThis.__secrets.marker,",
			"  });",
			"  const before = read();",
			"  console.log('start ' + globalThis.questpie.marker);",
			"  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));",
			"  const after = read();",
			"  console.log('end ' + globalThis.questpie.marker);",
			"  return { before, after };",
			"}",
		].join("\n");

		const runMarked = (svc: ExecutorService, marker: string) =>
			svc.run({
				source: guest,
				isolation: "trusted",
				secrets: { marker },
				bindings: { questpie: { marker } },
			});

		it("serializes overlapping trusted runs — no binding/secret/log bleed", async () => {
			const svc = new ExecutorService({});

			// Start BOTH runs in the same tick so their critical sections overlap.
			const [a, b] = await Promise.all([
				runMarked(svc, "A"),
				runMarked(svc, "B"),
			]);

			expect(a.ok).toBe(true);
			expect(b.ok).toBe(true);

			// Each run reads ONLY its own marker, both before and after the yields.
			expect(a.output).toEqual({
				before: { binding: "A", secret: "A" },
				after: { binding: "A", secret: "A" },
			});
			expect(b.output).toEqual({
				before: { binding: "B", secret: "B" },
				after: { binding: "B", secret: "B" },
			});

			// Console logs are not cross-attributed: each buffer holds only its run.
			expect(a.logs).toEqual(["log: start A", "log: end A"]);
			expect(b.logs).toEqual(["log: start B", "log: end B"]);

			// Globals are fully torn down once both runs complete (no dangling state).
			expect((globalThis as Record<string, unknown>).questpie).toBeUndefined();
			expect((globalThis as Record<string, unknown>).__secrets).toBeUndefined();
		});
	},
);
