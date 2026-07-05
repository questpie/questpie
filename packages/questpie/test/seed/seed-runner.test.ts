import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { isInTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { seed } from "../../src/server/seed/define-seed.js";
import { SeedRunner } from "../../src/server/seed/runner.js";
import type { Seed } from "../../src/server/seed/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

const seedPosts = collection("seed_posts").fields(({ f }) => ({
	title: f.text().required(),
}));

describe("SeedRunner", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let runner: SeedRunner;

	beforeEach(async () => {
		setup = await buildMockApp({});
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

	async function seedStepCount(seedId: string): Promise<number> {
		const result: any = await setup.app.db.execute(
			sql`SELECT COUNT(*) AS count FROM questpie_seed_steps WHERE seed_id = ${seedId}`,
		);
		const row = (result.rows || result)[0];
		return Number(row.count);
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

	it("validate rolls back collection writes through explicit and implicit context", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		const seeds: Seed[] = [
			makeSeed({
				id: "explicit-context",
				run: async ({ collections, createContext }) => {
					const ctx = await createContext();
					await collections.seed_posts.create({ title: "Explicit" }, ctx);
				},
			}),
			makeSeed({
				id: "implicit-context",
				run: async ({ collections }) => {
					await collections.seed_posts.create({ title: "Implicit" });
				},
			}),
		];

		await runner.run(seeds, { validate: true });

		const docs = await setup.app.collections.seed_posts.find({});
		expect(docs.totalDocs).toBe(0);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(0);
		expect(status.pending.map((seed) => seed.id)).toEqual([
			"explicit-context",
			"implicit-context",
		]);
	}, 15_000);

	it("runs normal seeds inside a transaction", async () => {
		let inTransaction = false;

		await runner.run([
			makeSeed({
				id: "transaction-check",
				run: async () => {
					inTransaction = isInTransaction();
				},
			}),
		]);

		expect(inTransaction).toBe(true);
	});

	it("rolls back normal seed writes and tracking on failure", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		const seeds: Seed[] = [
			makeSeed({
				id: "failing-write",
				run: async ({ collections }) => {
					await collections.seed_posts.create({ title: "Rolled back" });
					throw new Error("fail after write");
				},
			}),
		];

		await expect(runner.run(seeds)).rejects.toThrow("fail after write");

		const docs = await setup.app.collections.seed_posts.find({});
		expect(docs.totalDocs).toBe(0);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(0);
		expect(status.pending.map((seed) => seed.id)).toEqual(["failing-write"]);
	}, 15_000);

	// ── Step seeds ──────────────────────────────────────────────────────

	it("resumes checkpointed seeds from completed steps", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		let firstRuns = 0;
		let secondRuns = 0;
		let failSecond = true;

		const seeds: Seed[] = [
			seed.steps({
				id: "resume-steps",
				category: "dev",
				run: async ({ collections, step }) => {
					await step("first", async () => {
						firstRuns++;
						await collections.seed_posts.create({ title: "First" });
					});

					await step("second", async () => {
						secondRuns++;
						if (failSecond) {
							failSecond = false;
							throw new Error("second failed");
						}
						await collections.seed_posts.create({ title: "Second" });
					});
				},
			}),
		];

		await expect(runner.run(seeds)).rejects.toThrow("second failed");

		let docs = await setup.app.collections.seed_posts.find({
			orderBy: { title: "asc" },
		});
		expect(docs.docs.map((doc) => doc.title)).toEqual(["First"]);

		await runner.run(seeds);

		docs = await setup.app.collections.seed_posts.find({
			orderBy: { title: "asc" },
		});
		expect(docs.docs.map((doc) => doc.title)).toEqual(["First", "Second"]);
		expect(firstRuns).toBe(1);
		expect(secondRuns).toBe(2);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(1);
	});

	it("returns cached step results on rerun", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		let computeRuns = 0;
		let failAfterCompute = true;

		const seeds: Seed[] = [
			seed.steps({
				id: "cached-step-result",
				category: "dev",
				run: async ({ collections, step }) => {
					const result = await step("compute", async () => {
						computeRuns++;
						return { title: "Cached title" };
					});

					if (failAfterCompute) {
						failAfterCompute = false;
						throw new Error("fail after compute");
					}

					await step("write", async () => {
						await collections.seed_posts.create({ title: result.title });
					});
				},
			}),
		];

		await expect(runner.run(seeds)).rejects.toThrow("fail after compute");
		await runner.run(seeds);

		const docs = await setup.app.collections.seed_posts.find({});
		expect(docs.docs.map((doc) => doc.title)).toEqual(["Cached title"]);
		expect(computeRuns).toBe(1);
	});

	it("passes a transaction-bound context into step callbacks", async () => {
		let callbackDbInTransaction = false;
		let callbackCreateContextDbInTransaction = false;

		const seeds: Seed[] = [
			seed.steps({
				id: "step-callback-context",
				category: "dev",
				run: async ({ step }) => {
					await step("check-context", async ({ db, createContext }) => {
						callbackDbInTransaction = isInTransaction(db);
						const ctx = await createContext();
						callbackCreateContextDbInTransaction = isInTransaction(ctx.db);
					});
				},
			}),
		];

		await runner.run(seeds);

		expect(callbackDbInTransaction).toBe(true);
		expect(callbackCreateContextDbInTransaction).toBe(true);
	});

	it("force reruns checkpointed seed steps from the beginning", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		let stepRuns = 0;
		const seeds: Seed[] = [
			seed.steps({
				id: "force-steps",
				category: "dev",
				run: async ({ collections, step }) => {
					await step("write", async () => {
						stepRuns++;
						await collections.seed_posts.create({
							title: `Run ${stepRuns}`,
						});
					});
				},
			}),
		];

		await runner.run(seeds);
		expect(await seedStepCount("force-steps")).toBe(1);

		await runner.run(seeds, { force: true });

		const docs = await setup.app.collections.seed_posts.find({
			orderBy: { title: "asc" },
		});
		expect(docs.docs.map((doc) => doc.title)).toEqual(["Run 1", "Run 2"]);
		expect(stepRuns).toBe(2);
		expect(await seedStepCount("force-steps")).toBe(1);
	});

	it("failed force rerun leaves checkpointed seed pending", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		let shouldFail = false;
		const seeds: Seed[] = [
			seed.steps({
				id: "force-steps-failure",
				category: "dev",
				run: async ({ collections, step }) => {
					await step("write", async () => {
						if (shouldFail) throw new Error("forced failure");
						await collections.seed_posts.create({ title: "Created" });
					});
				},
			}),
		];

		await runner.run(seeds);

		shouldFail = true;
		await expect(runner.run(seeds, { force: true })).rejects.toThrow(
			"forced failure",
		);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(0);
		expect(status.pending.map((seed) => seed.id)).toEqual([
			"force-steps-failure",
		]);
		expect(await seedStepCount("force-steps-failure")).toBe(0);
	});

	it("failed force rerun resumes from completed force steps", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		let firstRuns = 0;
		let secondRuns = 0;
		let failSecond = false;
		const seeds: Seed[] = [
			seed.steps({
				id: "force-steps-partial",
				category: "dev",
				run: async ({ collections, step }) => {
					await step("first", async () => {
						firstRuns++;
						await collections.seed_posts.create({
							title: `First ${firstRuns}`,
						});
					});

					await step("second", async () => {
						secondRuns++;
						if (failSecond) {
							failSecond = false;
							throw new Error("second forced failure");
						}
						await collections.seed_posts.create({
							title: `Second ${secondRuns}`,
						});
					});
				},
			}),
		];

		await runner.run(seeds);

		failSecond = true;
		await expect(runner.run(seeds, { force: true })).rejects.toThrow(
			"second forced failure",
		);

		await runner.run(seeds);

		const docs = await setup.app.collections.seed_posts.find({
			orderBy: { title: "asc" },
		});
		expect(docs.docs.map((doc) => doc.title)).toEqual([
			"First 1",
			"First 2",
			"Second 1",
			"Second 3",
		]);
		expect(firstRuns).toBe(2);
		expect(secondRuns).toBe(3);
		expect(await seedStepCount("force-steps-partial")).toBe(2);
	});

	it("undo clears checkpointed seed steps", async () => {
		const seeds: Seed[] = [
			seed.steps({
				id: "undo-steps",
				category: "dev",
				run: async ({ step }) => {
					await step("one", async () => null);
				},
				undo: async () => {},
			}),
		];

		await runner.run(seeds);
		expect(await seedStepCount("undo-steps")).toBe(1);

		await runner.undo(seeds);

		expect(await seedStepCount("undo-steps")).toBe(0);
		const status = await runner.status(seeds);
		expect(status.pending.map((seed) => seed.id)).toEqual(["undo-steps"]);
	});

	it("reset clears checkpointed seed steps", async () => {
		const seeds: Seed[] = [
			seed.steps({
				id: "reset-steps",
				category: "dev",
				run: async ({ step }) => {
					await step("one", async () => null);
				},
			}),
		];

		await runner.run(seeds);
		expect(await seedStepCount("reset-steps")).toBe(1);

		await runner.reset({ only: ["reset-steps"] });

		expect(await seedStepCount("reset-steps")).toBe(0);
		const status = await runner.status(seeds);
		expect(status.pending.map((seed) => seed.id)).toEqual(["reset-steps"]);
	});

	it("validate rolls back checkpointed seed writes and step ledger", async () => {
		await setup.cleanup();
		setup = await buildMockApp({ collections: { seed_posts: seedPosts } });
		await runTestDbMigrations(setup.app);
		runner = new SeedRunner(setup.app, { silent: true });

		const seeds: Seed[] = [
			seed.steps({
				id: "validate-steps",
				category: "dev",
				run: async ({ collections, step }) => {
					await step("write", async () => {
						await collections.seed_posts.create({ title: "Dry run" });
					});
				},
			}),
		];

		await runner.run(seeds, { validate: true });

		const docs = await setup.app.collections.seed_posts.find({});
		expect(docs.totalDocs).toBe(0);
		expect(await seedStepCount("validate-steps")).toBe(0);

		const status = await runner.status(seeds);
		expect(status.executed).toHaveLength(0);
	}, 15_000);

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

	it("auto-includes checkpointed dependencies", async () => {
		const ran: string[] = [];

		const seeds: Seed[] = [
			seed.steps({
				id: "checkpointed-base",
				category: "required",
				run: async ({ step }) => {
					await step("base", async () => {
						ran.push("base");
					});
				},
			}),
			makeSeed({
				id: "dependent-simple",
				category: "dev",
				dependsOn: ["checkpointed-base"],
				run: async () => {
					ran.push("dependent");
				},
			}),
		];

		await runner.run(seeds, { only: ["dependent-simple"] });

		expect(ran).toEqual(["base", "dependent"]);
		expect(await seedStepCount("checkpointed-base")).toBe(1);
	});

	it("throws on circular seed dependencies", async () => {
		const seeds: Seed[] = [
			makeSeed({ id: "a", dependsOn: ["b"] }),
			makeSeed({ id: "b", dependsOn: ["a"] }),
		];

		await expect(runner.run(seeds)).rejects.toThrow(
			'Circular seed dependency detected at "a"',
		);
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

	it("provides db, createContext, and log in SeedContext", async () => {
		let receivedDb: any;
		let receivedCtx: any;
		let logCalled = false;

		const seeds: Seed[] = [
			makeSeed({
				id: "ctx-test",
				run: async ({ db, createContext, log }) => {
					receivedDb = db;
					receivedCtx = await createContext({ locale: "en" });
					log("test message");
					logCalled = true;
				},
			}),
		];

		await runner.run(seeds);

		expect(receivedDb).toBeDefined();
		expect(receivedCtx).toBeDefined();
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
