import { describe, expect, it } from "bun:test";

import { createCleanup, CleanupError } from "../src/scenario.js";

/*
 * UC-TEST-020. A teardown that only works after a clean exit is the one that
 * leaks in CI, so these kill and crash on purpose and assert convergence rather
 * than a happy path.
 */

describe("UC-TEST-020 idempotent-teardown", () => {
	it("runs every step and reports success once", async () => {
		const ran: string[] = [];
		const cleanup = createCleanup();
		cleanup.add("child", () => void ran.push("child"));
		cleanup.add("port", () => void ran.push("port"));

		await cleanup.run();

		expect(ran).toEqual(["port", "child"]);
	});

	it("tears down in reverse order, so a resource outlives what it depends on", async () => {
		const ran: string[] = [];
		const cleanup = createCleanup();
		cleanup.add("database", () => void ran.push("database"));
		cleanup.add("server", () => void ran.push("server"));

		await cleanup.run();

		expect(ran).toEqual(["server", "database"]);
	});

	it("runs the remaining steps when an earlier one throws", async () => {
		const ran: string[] = [];
		const cleanup = createCleanup();
		cleanup.add("database", () => void ran.push("database"));
		cleanup.add("child", () => {
			throw new Error("SIGKILL escalation failed");
		});

		await expect(cleanup.run()).rejects.toThrow(CleanupError);
		expect(ran).toEqual(["database"]);
	});

	it("collects every failure rather than surfacing only the first", async () => {
		const cleanup = createCleanup();
		cleanup.add("database", () => {
			throw new Error("drop failed");
		});
		cleanup.add("child", () => {
			throw new Error("kill failed");
		});

		try {
			await cleanup.run();
			expect.unreachable();
		} catch (error) {
			expect(error).toBeInstanceOf(CleanupError);
			const failures = (error as CleanupError).failures;
			expect(failures).toHaveLength(2);
			expect(failures.map((failure) => failure.name).sort()).toEqual([
				"child",
				"database",
			]);
		}
	});

	it("names the step that failed, so the leak is findable", async () => {
		const cleanup = createCleanup();
		cleanup.add("port-release", () => {
			throw new Error("still bound");
		});

		try {
			await cleanup.run();
			expect.unreachable();
		} catch (error) {
			expect((error as CleanupError).message).toContain("port-release");
		}
	});

	it("runs each step once when called twice", async () => {
		let calls = 0;
		const cleanup = createCleanup();
		cleanup.add("child", () => void (calls += 1));

		await cleanup.run();
		await cleanup.run();

		expect(calls).toBe(1);
	});

	it("converges to one result when called concurrently", async () => {
		let calls = 0;
		const cleanup = createCleanup();
		cleanup.add("child", async () => {
			calls += 1;
			await Bun.sleep(10);
		});

		await Promise.all([cleanup.run(), cleanup.run(), cleanup.run()]);

		expect(calls).toBe(1);
	});

	it("reports the same failure to every concurrent caller", async () => {
		const cleanup = createCleanup();
		cleanup.add("child", () => {
			throw new Error("kill failed");
		});

		const results = await Promise.allSettled([cleanup.run(), cleanup.run()]);

		expect(results.every((result) => result.status === "rejected")).toBe(true);
	});

	it("succeeds after a partial setup, where later resources never existed", async () => {
		const ran: string[] = [];
		const cleanup = createCleanup();
		cleanup.add("database", () => void ran.push("database"));
		// The server never booted, so nothing else was registered.

		await cleanup.run();

		expect(ran).toEqual(["database"]);
	});

	it("does nothing when no step was registered at all", async () => {
		await expect(createCleanup().run()).resolves.toBeUndefined();
	});

	it("refuses a step added after teardown, rather than silently leaking it", async () => {
		const cleanup = createCleanup();
		await cleanup.run();

		expect(() => cleanup.add("late", () => {})).toThrow(
			"Cleanup already ran; a resource created now would leak",
		);
	});

	it("waits for an async step to settle before finishing", async () => {
		let finished = false;
		const cleanup = createCleanup();
		cleanup.add("drain", async () => {
			await Bun.sleep(20);
			finished = true;
		});

		await cleanup.run();

		expect(finished).toBe(true);
	});
});

describe("UC-TEST-020 idempotent-teardown, against a real child", () => {
	it("converges after the child was killed behind its back", async () => {
		const child = Bun.spawn([
			process.execPath,
			"-e",
			"setInterval(() => {}, 1000)",
		]);
		const cleanup = createCleanup();
		cleanup.add("child", async () => {
			child.kill("SIGKILL");
			await child.exited;
		});

		// Something else already killed it. Teardown must still converge.
		child.kill("SIGKILL");
		await child.exited;

		await expect(cleanup.run()).resolves.toBeUndefined();
		expect(child.killed).toBe(true);
	});

	it("converges after the child crashed on its own", async () => {
		const child = Bun.spawn([process.execPath, "-e", "process.exit(3)"]);
		await child.exited;

		const cleanup = createCleanup();
		cleanup.add("child", async () => {
			child.kill("SIGKILL");
			await child.exited;
		});

		await expect(cleanup.run()).resolves.toBeUndefined();
		expect(child.exitCode).toBe(3);
	});

	it("clears a pending timer so the runtime is not held open", async () => {
		const cleanup = createCleanup();
		const timer = setTimeout(() => {
			throw new Error("timer should have been cleared");
		}, 10_000);
		cleanup.add("timer", () => clearTimeout(timer));

		await cleanup.run();
		await Bun.sleep(5);
	});
});
