import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { SeedRunner } from "../../src/server/seed/runner.js";
import type { Seed } from "../../src/server/seed/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

// Minimal builder — seeds don't need collections, just a app instance with a DB
const testModule = questpie({ name: "seed-test" }).fields(defaultFields);

describe("SeedRunner", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
	let runner: SeedRunner;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		runner = new SeedRunner(setup.app, { silent: true });
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	// ── Helpers ──────────────────────────────────────────────────────────

	function makeSeed(overrides: Partial<Seed> & { id: string }): Seed {
		return {
			category: "dev",
			run: async () => {},
			...overrides,
		};
	}

	async function tableExists(name: string): Promise<boolean> {
		const result: any = await setup.app.db.execute(
			sql.raw(
				`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${name}'`,
			),
		);
		return (result.rows || result).length > 0;
	}

	// ── Basic run ───────────────────────────────────────────────────────

	it("runs pending seeds and records them in tracking table", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "seed-a",
				run: async () => {
					ran.push("a");
				},
			}),
			makeSeed({
				id: "seed-b",
				run: async () => {
					ran.push("b");
				},
			}),
		];

		await runner.run(seeds);

		expect(ran).toEqual(["a", "b"]);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(2);
		expect(status.pending).toHaveLength(0);
	});

	it("skips already-executed seeds on second run", async () => {
		let runCount = 0;

		const seeds: Seed[] = [
			makeSeed({
				id: "once-only",
				run: async () => {
					runCount++;
				},
			}),
		];

		await runner.run(seeds);
		await runner.run(seeds);

		expect(runCount).toBe(1);
	});

	// ── Force ───────────────────────────────────────────────────────────

	it("force re-runs already-executed seeds", async () => {
		let runCount = 0;

		const seeds: Seed[] = [
			makeSeed({
				id: "forceable",
				run: async () => {
					runCount++;
				},
			}),
		];

		await runner.run(seeds);
		await runner.run(seeds, { force: true });

		expect(runCount).toBe(2);
	});

	// ── Category filter ─────────────────────────────────────────────────

	it("filters seeds by category", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "req",
				category: "required",
				run: async () => {
					ran.push("req");
				},
			}),
			makeSeed({
				id: "dev",
				category: "dev",
				run: async () => {
					ran.push("dev");
				},
			}),
			makeSeed({
				id: "tst",
				category: "test",
				run: async () => {
					ran.push("tst");
				},
			}),
		];

		await runner.run(seeds, { category: "required" });

		expect(ran).toEqual(["req"]);
	});

	it("filters by multiple categories", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "req",
				category: "required",
				run: async () => {
					ran.push("req");
				},
			}),
			makeSeed({
				id: "dev",
				category: "dev",
				run: async () => {
					ran.push("dev");
				},
			}),
			makeSeed({
				id: "tst",
				category: "test",
				run: async () => {
					ran.push("tst");
				},
			}),
		];

		await runner.run(seeds, { category: ["required", "dev"] });

		expect(ran).toEqual(["req", "dev"]);
	});

	// ── Only filter ─────────────────────────────────────────────────────

	it("runs only specific seeds by ID", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "alpha",
				run: async () => {
					ran.push("alpha");
				},
			}),
			makeSeed({
				id: "beta",
				run: async () => {
					ran.push("beta");
				},
			}),
			makeSeed({
				id: "gamma",
				run: async () => {
					ran.push("gamma");
				},
			}),
		];

		await runner.run(seeds, { only: ["beta"] });

		expect(ran).toEqual(["beta"]);
	});

	// ── Dependencies ────────────────────────────────────────────────────

	it("resolves dependency order via topological sort", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "child",
				dependsOn: ["parent"],
				run: async () => {
					ran.push("child");
				},
			}),
			makeSeed({
				id: "parent",
				run: async () => {
					ran.push("parent");
				},
			}),
		];

		await runner.run(seeds);

		expect(ran).toEqual(["parent", "child"]);
	});

	it("auto-includes dependencies even if not in filtered set", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "base",
				category: "required",
				run: async () => {
					ran.push("base");
				},
			}),
			makeSeed({
				id: "dependant",
				category: "dev",
				dependsOn: ["base"],
				run: async () => {
					ran.push("dependant");
				},
			}),
		];

		// Filter only dev, but "base" should be auto-included as dependency
		await runner.run(seeds, { only: ["dependant"] });

		expect(ran).toEqual(["base", "dependant"]);
	});

	// ── Undo ────────────────────────────────────────────────────────────

	it("undoes executed seeds in reverse order", async () => {
		const undone: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "first",
				run: async () => {},
				undo: async () => {
					undone.push("first");
				},
			}),
			makeSeed({
				id: "second",
				run: async () => {},
				undo: async () => {
					undone.push("second");
				},
			}),
		];

		await runner.run(seeds);
		await runner.undo(seeds);

		// Reverse order
		expect(undone).toEqual(["second", "first"]);

		// Should be removed from tracking
		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(0);
		expect(status.pending).toHaveLength(2);
	});

	it("skips undo for seeds without undo function", async () => {
		const undone: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "no-undo",
				run: async () => {},
				// no undo
			}),
			makeSeed({
				id: "has-undo",
				run: async () => {},
				undo: async () => {
					undone.push("has-undo");
				},
			}),
		];

		await runner.run(seeds);
		await runner.undo(seeds);

		expect(undone).toEqual(["has-undo"]);

		const status = await runner.status(seeds);
		// "no-undo" still in executed (can't undo it)
		expect(status.executed).toHaveLength(1);
		expect(status.executed[0]?.id).toBe("no-undo");
	});

	it("filters undo by category", async () => {
		const undone: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "req-seed",
				category: "required",
				run: async () => {},
				undo: async () => {
					undone.push("req");
				},
			}),
			makeSeed({
				id: "dev-seed",
				category: "dev",
				run: async () => {},
				undo: async () => {
					undone.push("dev");
				},
			}),
		];

		await runner.run(seeds);
		await runner.undo(seeds, { category: "dev" });

		expect(undone).toEqual(["dev"]);
	});

	// ── Reset ───────────────────────────────────────────────────────────

	it("resets all seed tracking", async () => {
		const seeds: Seed[] = [makeSeed({ id: "a" }), makeSeed({ id: "b" })];

		await runner.run(seeds);
		const before = await runner.status(seeds);
		expect(before.executed).toHaveLength(2);

		await runner.reset();

		const after = await runner.status(seeds);
		expect(after.executed).toHaveLength(0);
		expect(after.pending).toHaveLength(2);
	});

	it("resets tracking for specific seeds only", async () => {
		const seeds: Seed[] = [
			makeSeed({ id: "keep" }),
			makeSeed({ id: "remove" }),
		];

		await runner.run(seeds);
		await runner.reset({ only: ["remove"] });

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(1);
		expect(status.executed[0]?.id).toBe("keep");
		expect(status.pending).toHaveLength(1);
		expect(status.pending[0]?.id).toBe("remove");
	});

	// ── Status ──────────────────────────────────────────────────────────

	it("returns correct status with pending and executed", async () => {
		const seeds: Seed[] = [
			makeSeed({ id: "done", description: "Already executed" }),
			makeSeed({ id: "todo", description: "Not yet run" }),
		];

		await runner.run(seeds, { only: ["done"] });

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(1);
		expect(status.executed[0]?.id).toBe("done");
		expect(status.pending).toHaveLength(1);
		expect(status.pending[0]?.id).toBe("todo");
		expect(status.pending[0]?.description).toBe("Not yet run");
	});

	// ── Error handling ──────────────────────────────────────────────────

	it("throws and stops on seed failure", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			makeSeed({
				id: "good",
				run: async () => {
					ran.push("good");
				},
			}),
			makeSeed({
				id: "bad",
				run: async () => {
					throw new Error("Seed failed!");
				},
			}),
			makeSeed({
				id: "after-bad",
				run: async () => {
					ran.push("after-bad");
				},
			}),
		];

		await expect(runner.run(seeds)).rejects.toThrow("Seed failed!");
		expect(ran).toEqual(["good"]);
		// Only the successful seed should be tracked
		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(1);
		expect(status.executed[0]?.id).toBe("good");
	});

	// ── SeedContext ─────────────────────────────────────────────────────

	it("provides app, ctx, and log in SeedContext", async () => {
		let receivedCms: any;
		let receivedCtx: any;
		let logCalled = false;

		const seeds: Seed[] = [
			makeSeed({
				id: "ctx-test",
				run: async ({ app, ctx, log }) => {
					receivedCms = app;
					receivedCtx = ctx;
					log("test message");
					logCalled = true;
				},
			}),
		];

		await runner.run(seeds);

		expect(receivedCms).toBe(setup.app);
		expect(receivedCtx).toBeDefined();
		expect(receivedCtx.accessMode).toBe("system");
		expect(logCalled).toBe(true);
	});

	// ── Tracking table ──────────────────────────────────────────────────

	it("creates questpie_seeds table automatically", async () => {
		// Table shouldn't exist before first run
		const beforeExists = await tableExists("questpie_seeds");
		expect(beforeExists).toBe(false);

		await runner.run([]);

		const afterExists = await tableExists("questpie_seeds");
		expect(afterExists).toBe(true);
	});
});
