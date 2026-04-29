/**
 * QUE-246 — PoC: async scoped memoization / disposal / cycle detection
 *
 * Gate test suite. All tests must pass for Phase 4 to proceed.
 * Verdict: PASS if all green, FAIL if any red.
 */
import { describe, expect, it } from "bun:test";

import {
	CircularDependencyError,
	ScopedContainer,
	SingletonScopedViolationError,
	type ServiceDef,
} from "../../../src/server/services/scoped-container.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function container(
	defs: Record<string, ServiceDef>,
): ScopedContainer {
	const c = new ScopedContainer();
	for (const [name, def] of Object.entries(defs)) {
		c.register(name, def);
	}
	return c;
}

// ---------------------------------------------------------------------------
// 1. Scoped memoization
// ---------------------------------------------------------------------------

describe("scoped memoization", () => {
	it("resolves the same scoped service once per scope", async () => {
		let callCount = 0;
		const c = container({
			counter: {
				lifecycle: "scoped",
				create: () => ({ id: ++callCount }),
			},
		});
		await c.init();

		const scope = c.createScope();
		const a = scope.resolve<{ id: number }>("counter");
		const b = scope.resolve<{ id: number }>("counter");

		expect(a).toBe(b); // same reference
		expect(callCount).toBe(1); // factory called once
		await scope.dispose();
		await c.destroy();
	});

	it("different scopes get different instances", async () => {
		let callCount = 0;
		const c = container({
			counter: {
				lifecycle: "scoped",
				create: () => ({ id: ++callCount }),
			},
		});
		await c.init();

		const scope1 = c.createScope();
		const scope2 = c.createScope();

		const a = scope1.resolve<{ id: number }>("counter");
		const b = scope2.resolve<{ id: number }>("counter");

		expect(a).not.toBe(b);
		expect(a.id).toBe(1);
		expect(b.id).toBe(2);

		await scope1.dispose();
		await scope2.dispose();
		await c.destroy();
	});

	it("scoped service can depend on another scoped service (memoized)", async () => {
		const c = container({
			db: {
				lifecycle: "scoped",
				create: () => ({ query: (sql: string) => `result:${sql}` }),
			},
			repo: {
				lifecycle: "scoped",
				create: (ctx) => {
					const db = ctx.resolve<{ query: (s: string) => string }>("db");
					return { findAll: () => db.query("SELECT *") };
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		const repo = scope.resolve<{ findAll: () => string }>("repo");
		expect(repo.findAll()).toBe("result:SELECT *");

		// db should be memoized — same instance
		const db1 = scope.resolve("db");
		const db2 = scope.resolve("db");
		expect(db1).toBe(db2);

		await scope.dispose();
		await c.destroy();
	});
});

// ---------------------------------------------------------------------------
// 2. Async scoped creation
// ---------------------------------------------------------------------------

describe("async scoped creation", () => {
	it("resolveAsync creates async scoped service and memoizes it", async () => {
		let callCount = 0;
		const c = container({
			asyncSvc: {
				lifecycle: "scoped",
				create: async () => {
					await new Promise((r) => setTimeout(r, 1));
					return { ready: true, id: ++callCount };
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		const a = await scope.resolveAsync<{ ready: boolean; id: number }>(
			"asyncSvc",
		);
		const b = await scope.resolveAsync<{ ready: boolean; id: number }>(
			"asyncSvc",
		);

		expect(a).toBe(b); // memoized
		expect(a.ready).toBe(true);
		expect(callCount).toBe(1);

		await scope.dispose();
		await c.destroy();
	});

	it("sync resolve throws on async scoped service", async () => {
		const c = container({
			asyncSvc: {
				lifecycle: "scoped",
				create: async () => ({ ready: true }),
			},
		});
		await c.init();

		const scope = c.createScope();
		expect(() => scope.resolve("asyncSvc")).toThrow(
			"returned a Promise",
		);

		await scope.dispose();
		await c.destroy();
	});

	it("async scoped service can depend on sync scoped service", async () => {
		const c = container({
			config: {
				lifecycle: "scoped",
				create: () => ({ timeout: 5000 }),
			},
			client: {
				lifecycle: "scoped",
				create: async (ctx) => {
					const cfg = ctx.resolve<{ timeout: number }>("config");
					await new Promise((r) => setTimeout(r, 1));
					return { timeout: cfg.timeout, connected: true };
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		const client = await scope.resolveAsync<{
			timeout: number;
			connected: boolean;
		}>("client");

		expect(client.timeout).toBe(5000);
		expect(client.connected).toBe(true);

		await scope.dispose();
		await c.destroy();
	});
});

// ---------------------------------------------------------------------------
// 3. Disposal
// ---------------------------------------------------------------------------

describe("disposal", () => {
	it("disposes scoped services in reverse creation order", async () => {
		const disposed: string[] = [];

		const c = container({
			first: {
				lifecycle: "scoped",
				create: () => ({ name: "first" }),
				dispose: () => {
					disposed.push("first");
				},
			},
			second: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("first"); // depends on first
					return { name: "second" };
				},
				dispose: () => {
					disposed.push("second");
				},
			},
			third: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("second"); // depends on second
					return { name: "third" };
				},
				dispose: () => {
					disposed.push("third");
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		scope.resolve("third"); // triggers: first → second → third

		await scope.dispose();

		// Reverse of creation: third, second, first
		expect(disposed).toEqual(["third", "second", "first"]);
		await c.destroy();
	});

	it("async dispose is awaited", async () => {
		const events: string[] = [];

		const c = container({
			heavy: {
				lifecycle: "scoped",
				create: () => ({ connections: 5 }),
				dispose: async () => {
					events.push("dispose:start");
					await new Promise((r) => setTimeout(r, 10));
					events.push("dispose:end");
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		scope.resolve("heavy");
		await scope.dispose();

		expect(events).toEqual(["dispose:start", "dispose:end"]);
		await c.destroy();
	});

	it("dispose is idempotent (calling twice is safe)", async () => {
		let disposeCount = 0;
		const c = container({
			svc: {
				lifecycle: "scoped",
				create: () => ({}),
				dispose: () => {
					disposeCount++;
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		scope.resolve("svc");

		await scope.dispose();
		await scope.dispose(); // second call is no-op

		expect(disposeCount).toBe(1);
		await c.destroy();
	});

	it("cannot resolve from disposed scope", async () => {
		const c = container({
			svc: { lifecycle: "scoped", create: () => ({}) },
		});
		await c.init();

		const scope = c.createScope();
		await scope.dispose();

		expect(() => scope.resolve("svc")).toThrow("disposed scope");
		await c.destroy();
	});

	it("singleton disposal happens in reverse creation order", async () => {
		const disposed: string[] = [];

		const c = container({
			alpha: {
				lifecycle: "singleton",
				create: () => ({ name: "alpha" }),
				dispose: () => {
					disposed.push("alpha");
				},
			},
			beta: {
				lifecycle: "singleton",
				create: (ctx) => {
					ctx.resolve("alpha");
					return { name: "beta" };
				},
				dispose: () => {
					disposed.push("beta");
				},
			},
		});
		await c.init();
		await c.destroy();

		expect(disposed).toEqual(["beta", "alpha"]);
	});
});

// ---------------------------------------------------------------------------
// 4. Circular dependency detection
// ---------------------------------------------------------------------------

describe("cycle detection", () => {
	it("detects direct circular dependency in scoped services", async () => {
		const c = container({
			a: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("b");
					return {};
				},
			},
			b: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("a");
					return {};
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		expect(() => scope.resolve("a")).toThrow(CircularDependencyError);
	});

	it("detects transitive circular dependency (A → B → C → A)", async () => {
		const c = container({
			a: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("b");
					return {};
				},
			},
			b: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("c");
					return {};
				},
			},
			c: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("a");
					return {};
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		expect(() => scope.resolve("a")).toThrow("a -> b -> c -> a");
	});

	it("detects circular dependency in singleton services", async () => {
		const c = container({
			x: {
				lifecycle: "singleton",
				create: (ctx) => {
					ctx.resolve("y");
					return {};
				},
			},
			y: {
				lifecycle: "singleton",
				create: (ctx) => {
					ctx.resolve("x");
					return {};
				},
			},
		});

		await expect(c.init()).rejects.toThrow(CircularDependencyError);
	});

	it("non-circular diamond dependency is fine", async () => {
		// A → B, A → C, B → D, C → D  (diamond, not circular)
		const created: string[] = [];

		const c = container({
			d: {
				lifecycle: "scoped",
				create: () => {
					created.push("d");
					return { name: "d" };
				},
			},
			b: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("d");
					created.push("b");
					return { name: "b" };
				},
			},
			c_svc: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("d");
					created.push("c");
					return { name: "c" };
				},
			},
			a: {
				lifecycle: "scoped",
				create: (ctx) => {
					ctx.resolve("b");
					ctx.resolve("c_svc");
					created.push("a");
					return { name: "a" };
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		scope.resolve("a");

		// d created once (memoized), b and c each once, a once
		expect(created).toEqual(["d", "b", "c", "a"]);
		await scope.dispose();
		await c.destroy();
	});
});

// ---------------------------------------------------------------------------
// 5. Singleton → scoped guard
// ---------------------------------------------------------------------------

describe("singleton → scoped guard", () => {
	it("blocks singleton depending on scoped service at init time", async () => {
		const c = container({
			scopedSvc: {
				lifecycle: "scoped",
				create: () => ({ data: "per-request" }),
			},
			singletonSvc: {
				lifecycle: "singleton",
				create: (ctx) => {
					ctx.resolve("scopedSvc"); // VIOLATION
					return {};
				},
			},
		});

		await expect(c.init()).rejects.toThrow(SingletonScopedViolationError);
	});

	it("allows scoped depending on singleton", async () => {
		const c = container({
			config: {
				lifecycle: "singleton",
				create: () => ({ dbUrl: "postgres://..." }),
			},
			repo: {
				lifecycle: "scoped",
				create: (ctx) => {
					const cfg = ctx.resolve<{ dbUrl: string }>("config");
					return { url: cfg.dbUrl };
				},
			},
		});
		await c.init();

		const scope = c.createScope();
		const repo = scope.resolve<{ url: string }>("repo");
		expect(repo.url).toBe("postgres://...");

		await scope.dispose();
		await c.destroy();
	});
});

// ---------------------------------------------------------------------------
// 6. Mixed singleton + scoped in scope resolution
// ---------------------------------------------------------------------------

describe("mixed resolution in scope", () => {
	it("scoped services see singletons, singletons are shared across scopes", async () => {
		const c = container({
			logger: {
				lifecycle: "singleton",
				create: () => {
					const logs: string[] = [];
					return { log: (msg: string) => logs.push(msg), logs };
				},
			},
			handler: {
				lifecycle: "scoped",
				create: (ctx) => {
					const logger = ctx.resolve<{
						log: (m: string) => void;
						logs: string[];
					}>("logger");
					return {
						handle: (req: string) => {
							logger.log(`handled: ${req}`);
						},
						getLogs: () => logger.logs,
					};
				},
			},
		});
		await c.init();

		const scope1 = c.createScope();
		const scope2 = c.createScope();

		const h1 = scope1.resolve<{
			handle: (r: string) => void;
			getLogs: () => string[];
		}>("handler");
		const h2 = scope2.resolve<{
			handle: (r: string) => void;
			getLogs: () => string[];
		}>("handler");

		expect(h1).not.toBe(h2); // different scoped instances

		h1.handle("req-1");
		h2.handle("req-2");

		// Both write to the same singleton logger
		expect(h1.getLogs()).toEqual(["handled: req-1", "handled: req-2"]);
		expect(h1.getLogs()).toBe(h2.getLogs()); // same array reference

		await scope1.dispose();
		await scope2.dispose();
		await c.destroy();
	});
});
