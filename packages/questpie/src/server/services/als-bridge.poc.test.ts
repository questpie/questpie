/**
 * ALS Bridge PoC — QUE-256
 *
 * Validates that the new scoped-container-in-ALS model can coexist with the
 * existing transaction ALS (`withTransaction` / `onAfterCommit`).
 *
 * Key things proven:
 * 1. Two separate AsyncLocalStorage instances do NOT interfere.
 * 2. A scoped container stored in ALS can serve as the "bridge" —
 *    `getContext()` reads services from it instead of flat values.
 * 3. Nesting works: runWithContext → withTransaction → nested runWithContext
 *    preserves both ALS contexts independently.
 * 4. The bridge can expose both singleton and scoped services via Proxy.
 *
 * Verdict criteria:
 * - All tests pass → GATE PASSED, proceed with Phase 5 implementation.
 * - Any test fails → investigate before proceeding.
 */

import { describe, expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";

import {
	type Lifecycle,
	type ServiceDef,
	Scope,
	ScopedContainer,
} from "./scoped-container.js";

// ============================================================================
// 1. Minimal ALS bridge implementation (what Phase 5 will build)
// ============================================================================

/** Simulates the transaction ALS (already exists in transaction.ts) */
const transactionALS = new AsyncLocalStorage<{
	tx: unknown;
	afterCommit: Array<() => Promise<void>>;
}>();

/** New service-context ALS — stores a Scope (or bridge object) */
interface ServiceContextStore {
	/** The scoped container for this execution scope */
	scope: Scope;
	/** Singleton projection (always same reference) */
	singletons: Map<string, unknown>;
	/** Original service definitions (for type-checking lifecycle) */
	defs: Map<string, ServiceDef>;
}

const serviceContextALS = new AsyncLocalStorage<ServiceContextStore>();

/**
 * Bridge: run a function within a service-context scope.
 * Analogous to current `runWithContext`, but stores a Scope instead of flat values.
 */
function runWithServiceScope<T>(
	container: ScopedContainer,
	singletons: Map<string, unknown>,
	defs: Map<string, ServiceDef>,
	fn: () => T | Promise<T>,
): Promise<T> {
	const scope = container.createScope();
	return serviceContextALS.run({ scope, singletons, defs }, fn) as Promise<T>;
}

/**
 * Bridge getContext() — returns a Proxy that resolves services from the current scope.
 * Singletons come from container cache; scoped services come from Scope.
 */
function getServiceContext(): Record<string, unknown> {
	const store = serviceContextALS.getStore();
	if (!store) {
		throw new Error("getServiceContext() called outside service scope");
	}

	return new Proxy(
		{},
		{
			get(_, prop) {
				if (typeof prop !== "string") return undefined;
				return store.scope.resolve(prop);
			},
			has(_, prop) {
				if (typeof prop !== "string") return false;
				return store.defs.has(prop);
			},
		},
	);
}

function tryGetServiceContext(): Record<string, unknown> | undefined {
	const store = serviceContextALS.getStore();
	if (!store) return undefined;
	return getServiceContext();
}

// ============================================================================
// Simulated withTransaction (mirrors real transaction.ts)
// ============================================================================

async function withTransaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
	const existing = transactionALS.getStore();

	if (existing) {
		return fn(existing.tx);
	}

	const fakeTx = { __tx: true, id: Math.random() };
	const ctx = { tx: fakeTx, afterCommit: [] as Array<() => Promise<void>> };

	const result = await transactionALS.run(ctx, () => fn(fakeTx));

	for (const cb of ctx.afterCommit) {
		await cb();
	}

	return result;
}

function onAfterCommit(cb: () => Promise<void>): void {
	const ctx = transactionALS.getStore();
	if (ctx) {
		ctx.afterCommit.push(cb);
	} else {
		cb().catch(console.error);
	}
}

// ============================================================================
// 2. Tests
// ============================================================================

describe("QUE-256: ALS Bridge PoC", () => {
	// Helper: create a container with test services
	function createTestContainer() {
		const container = new ScopedContainer();
		const defs = new Map<string, ServiceDef>();

		// Singleton: db
		const dbDef: ServiceDef = {
			lifecycle: "singleton",
			create: () => ({ type: "db", connection: "pg://test" }),
		};
		container.register("db", dbDef);
		defs.set("db", dbDef);

		// Singleton: logger
		const loggerDef: ServiceDef = {
			lifecycle: "singleton",
			create: () => ({ type: "logger", logs: [] as string[] }),
		};
		container.register("logger", loggerDef);
		defs.set("logger", loggerDef);

		// Scoped: session (per-request)
		const sessionDef: ServiceDef = {
			lifecycle: "scoped",
			create: (ctx) => ({
				type: "session",
				userId: `user-${Math.random().toString(36).slice(2, 6)}`,
				db: ctx.resolve("db"), // scoped depends on singleton
			}),
		};
		container.register("session", sessionDef);
		defs.set("session", sessionDef);

		// Scoped: locale
		const localeDef: ServiceDef = {
			lifecycle: "scoped",
			create: () => ({ type: "locale", value: "en" }),
		};
		container.register("locale", localeDef);
		defs.set("locale", localeDef);

		return { container, defs };
	}

	// -------------------------------------------------------------------
	// Test 1: Two ALS instances don't interfere
	// -------------------------------------------------------------------
	test("two ALS instances (transaction + service context) are independent", async () => {
		const { container, defs } = createTestContainer();
		await container.init();

		const singletons = (container as any)._singletons as Map<string, unknown>;

		let txVisibleInsideServiceScope = false;
		let serviceVisibleInsideTxScope = false;

		// Start service scope
		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();
			expect((ctx.db as any).type).toBe("db");

			// Start transaction scope INSIDE service scope
			await withTransaction(async (tx) => {
				// Service context still accessible?
				const innerCtx = tryGetServiceContext();
				txVisibleInsideServiceScope = transactionALS.getStore() !== undefined;
				serviceVisibleInsideTxScope = innerCtx !== undefined;

				expect((tx as any).__tx).toBe(true);
				expect(innerCtx).toBeDefined();
				expect((innerCtx!.db as any).type).toBe("db");

				return tx;
			});

			return undefined;
		});

		expect(txVisibleInsideServiceScope).toBe(true);
		expect(serviceVisibleInsideTxScope).toBe(true);

		// Outside both scopes
		expect(transactionALS.getStore()).toBeUndefined();
		expect(serviceContextALS.getStore()).toBeUndefined();

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 2: Scoped services are per-scope memoized
	// -------------------------------------------------------------------
	test("scoped services are memoized within a single scope", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();
			const session1 = ctx.session;
			const session2 = ctx.session;

			// Same instance — memoized
			expect(session1).toBe(session2);

			return undefined;
		});

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 3: Different scopes get different scoped instances
	// -------------------------------------------------------------------
	test("different scopes produce different scoped service instances", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		let session1: unknown;
		let session2: unknown;
		let db1: unknown;
		let db2: unknown;

		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();
			session1 = ctx.session;
			db1 = ctx.db;
			return undefined;
		});

		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();
			session2 = ctx.session;
			db2 = ctx.db;
			return undefined;
		});

		// Scoped: different instances
		expect(session1).not.toBe(session2);

		// Singleton: same instance
		expect(db1).toBe(db2);

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 4: Transaction ALS works inside service scope with afterCommit
	// -------------------------------------------------------------------
	test("onAfterCommit works inside service scope", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		const executed: string[] = [];

		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();

			await withTransaction(async (tx) => {
				// Schedule afterCommit
				onAfterCommit(async () => {
					// Service context should still be accessible in afterCommit
					// (it runs after tx.run() completes but still inside serviceContextALS.run())
					const innerCtx = tryGetServiceContext();
					if (innerCtx) {
						executed.push(`afterCommit:${(innerCtx.db as any).type}`);
					} else {
						executed.push("afterCommit:no-ctx");
					}
				});

				executed.push("inside-tx");
				return tx;
			});

			executed.push("after-tx");
			return undefined;
		});

		expect(executed).toEqual([
			"inside-tx",
			"afterCommit:db", // afterCommit runs after tx but still in service scope
			"after-tx",
		]);

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 5: Nested service scopes (re-entry)
	// -------------------------------------------------------------------
	test("nested service scopes create independent scoped instances", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		let outerSession: unknown;
		let innerSession: unknown;

		await runWithServiceScope(container, singletons, defs, async () => {
			outerSession = getServiceContext().session;

			// Nested scope (e.g., job handler inside HTTP handler)
			await runWithServiceScope(container, singletons, defs, async () => {
				innerSession = getServiceContext().session;

				// Inner scope has its own session
				expect(innerSession).not.toBe(outerSession);
				return undefined;
			});

			// Back to outer scope
			const restoredSession = getServiceContext().session;
			expect(restoredSession).toBe(outerSession);

			return undefined;
		});

		expect(outerSession).toBeDefined();
		expect(innerSession).toBeDefined();

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 6: Full real-world scenario — HTTP request with CRUD + transaction
	// -------------------------------------------------------------------
	test("real-world: HTTP scope → CRUD → transaction → afterCommit → nested CRUD", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		const timeline: string[] = [];

		// Simulate HTTP request handler
		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();
			const session = ctx.session as { userId: string };
			timeline.push(`session:${session.userId}`);

			// CRUD operation with transaction
			await withTransaction(async (tx) => {
				timeline.push("tx:start");

				// Nested read — service context still available
				const innerCtx = getServiceContext();
				expect((innerCtx.session as { userId: string }).userId).toBe(
					session.userId,
				);
				timeline.push("tx:crud-read");

				// Schedule side-effect after commit
				onAfterCommit(async () => {
					timeline.push("afterCommit:side-effect");
					// Context is still available
					const afterCtx = tryGetServiceContext();
					expect(afterCtx).toBeDefined();
				});

				timeline.push("tx:end");
				return undefined;
			});

			timeline.push("handler:done");
			return undefined;
		});

		expect(timeline).toEqual([
			`session:${(timeline[0] as string).split(":")[1]}`, // dynamic userId
			"tx:start",
			"tx:crud-read",
			"tx:end",
			"afterCommit:side-effect",
			"handler:done",
		]);

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 7: Transaction ALS nesting inside service scope
	// -------------------------------------------------------------------
	test("nested transactions reuse parent tx inside service scope", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		await runWithServiceScope(container, singletons, defs, async () => {
			let outerTx: unknown;
			let innerTx: unknown;

			await withTransaction(async (tx1) => {
				outerTx = tx1;

				await withTransaction(async (tx2) => {
					innerTx = tx2;
					return undefined;
				});

				return undefined;
			});

			// Nested transaction reuses parent
			expect(outerTx).toBe(innerTx);
			return undefined;
		});

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 8: Concurrent scopes don't leak between async contexts
	// -------------------------------------------------------------------
	test("concurrent scopes are isolated via ALS", async () => {
		const { container, defs } = createTestContainer();
		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		const results: string[] = [];

		await Promise.all([
			runWithServiceScope(container, singletons, defs, async () => {
				const session = getServiceContext().session as { userId: string };
				// Yield to event loop
				await new Promise((r) => setTimeout(r, 10));
				// Should still see OWN session, not the other scope's
				const afterYield = getServiceContext().session as { userId: string };
				expect(afterYield.userId).toBe(session.userId);
				results.push(`scope-A:${session.userId}`);
				return undefined;
			}),
			runWithServiceScope(container, singletons, defs, async () => {
				const session = getServiceContext().session as { userId: string };
				await new Promise((r) => setTimeout(r, 5));
				const afterYield = getServiceContext().session as { userId: string };
				expect(afterYield.userId).toBe(session.userId);
				results.push(`scope-B:${session.userId}`);
				return undefined;
			}),
		]);

		expect(results).toHaveLength(2);
		// Two different sessions
		const [a, b] = results;
		expect(a!.split(":")[1]).not.toBe(b!.split(":")[1]);

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 9: Proxy-based namespace projection from scope
	// -------------------------------------------------------------------
	test("Proxy projects singletons and scoped services by namespace", async () => {
		const container = new ScopedContainer();
		const defs = new Map<string, ServiceDef>();

		// Simulate namespace: null (top-level) singleton
		const dbDef: ServiceDef = {
			lifecycle: "singleton",
			create: () => ({ type: "db" }),
		};
		container.register("db", dbDef);
		defs.set("db", dbDef);

		// Simulate namespace: null scoped
		const sessionDef: ServiceDef = {
			lifecycle: "scoped",
			create: () => ({ type: "session", id: "s-1" }),
		};
		container.register("session", sessionDef);
		defs.set("session", sessionDef);

		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		await runWithServiceScope(container, singletons, defs, async () => {
			const ctx = getServiceContext();

			// Top-level projection works
			expect((ctx.db as any).type).toBe("db");
			expect((ctx.session as any).type).toBe("session");

			// 'in' operator works
			expect("db" in ctx).toBe(true);
			expect("session" in ctx).toBe(true);
			expect("nonexistent" in ctx).toBe(false);

			return undefined;
		});

		await container.destroy();
	});

	// -------------------------------------------------------------------
	// Test 10: app projection excludes scoped services
	// -------------------------------------------------------------------
	test("app-level projection only exposes singletons, not scoped", async () => {
		const container = new ScopedContainer();
		const defs = new Map<string, ServiceDef>();

		const dbDef: ServiceDef = {
			lifecycle: "singleton",
			create: () => ({ type: "db" }),
		};
		container.register("db", dbDef);
		defs.set("db", dbDef);

		const sessionDef: ServiceDef = {
			lifecycle: "scoped",
			create: () => ({ type: "session" }),
		};
		container.register("session", sessionDef);
		defs.set("session", sessionDef);

		await container.init();
		const singletons = (container as any)._singletons as Map<string, unknown>;

		// app projection — only singletons
		const appProxy = new Proxy(
			{},
			{
				get(_, prop) {
					if (typeof prop !== "string") return undefined;
					const def = defs.get(prop);
					if (!def || def.lifecycle !== "singleton") return undefined;
					return singletons.get(prop);
				},
				has(_, prop) {
					if (typeof prop !== "string") return false;
					const def = defs.get(prop);
					return def?.lifecycle === "singleton";
				},
			},
		);

		expect((appProxy as any).db.type).toBe("db");
		expect((appProxy as any).session).toBeUndefined();
		expect("db" in appProxy).toBe(true);
		expect("session" in appProxy).toBe(false);

		await container.destroy();
	});
});
