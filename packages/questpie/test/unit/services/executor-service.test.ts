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
