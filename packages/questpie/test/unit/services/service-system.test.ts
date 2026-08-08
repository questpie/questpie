import { describe, expect, it } from "bun:test";

import {
	ServiceBuilder,
	createApp,
	createContextFactory,
	extractAppServices,
	module,
	service,
	type ServiceInstanceOf,
} from "../../../src/exports/index.js";
import { MockKVAdapter } from "../../utils/mocks/kv.adapter.js";
import { MockLogger } from "../../utils/mocks/logger.adapter.js";
import { MockMailAdapter } from "../../utils/mocks/mailer.adapter.js";
import { MockQueueAdapter } from "../../utils/mocks/queue.adapter.js";
import { createTestDb } from "../../utils/test-db.js";

async function createServiceApp(
	services: Record<string, ServiceBuilder<any>>,
): Promise<{ app: any; cleanup: () => Promise<void> }> {
	const db = await createTestDb();

	try {
		const app = await createApp(
			module({
				name: "service-test",
				services,
			}),
			{
				app: { url: "http://localhost:3000" },
				db: { pglite: db },
				email: { adapter: new MockMailAdapter() },
				queue: { adapter: new MockQueueAdapter() },
				kv: { adapter: new MockKVAdapter() },
				logger: { adapter: new MockLogger() },
			},
		);

		return {
			app,
			cleanup: async () => {
				await app.destroy();
				await db.close();
			},
		};
	} catch (error) {
		await db.close();
		throw error;
	}
}

describe("service system", () => {
	it("builds immutable ServiceBuilder chains without .build()", () => {
		const base = service();
		const withLifecycle = base.lifecycle("singleton");
		const withCreate = withLifecycle.create(() => ({ ok: true }));
		const withDispose = withCreate.dispose(() => {});
		const withNamespace = withDispose.namespace("analytics");

		expect(base).toBeInstanceOf(ServiceBuilder);
		expect(base).not.toBe(withLifecycle);
		expect(withLifecycle).not.toBe(withCreate);
		expect(withCreate).not.toBe(withDispose);
		expect(withDispose).not.toBe(withNamespace);

		expect(base.state.lifecycle).toBeUndefined();
		expect(withLifecycle.state.lifecycle).toBe("singleton");
		expect(typeof withCreate.state.create).toBe("function");
		expect(typeof withDispose.state.dispose).toBe("function");
		expect(withNamespace.state.namespace).toBe("analytics");
		expect("build" in withNamespace).toBe(false);
	});

	it("wraps plain object services into ServiceBuilder", () => {
		const wrapped = service({
			lifecycle: "singleton",
			namespace: null,
			create: () => ({ ok: true }),
		});

		expect(wrapped).toBeInstanceOf(ServiceBuilder);
		expect(wrapped.state.lifecycle).toBe("singleton");
		expect(wrapped.state.namespace).toBeNull();
		expect((wrapped.state.create as (ctx: any) => { ok: boolean })({}).ok).toBe(
			true,
		);
	});

	it("extracts ServiceInstanceOf from builders and plain create() fallback", () => {
		const typedBuilder = service().create(() => ({ ping: () => "pong" }));

		type BuilderInstance = ServiceInstanceOf<typeof typedBuilder>;
		const builderInstance: BuilderInstance = { ping: () => "pong" };
		expect(builderInstance.ping()).toBe("pong");

		type PlainInstance = ServiceInstanceOf<{ create: () => number }>;
		const plainInstance: PlainInstance = 7;
		expect(plainInstance).toBe(7);
	});

	it("initializes singleton services with lazy proxy context", async () => {
		const creationOrder: string[] = [];

		const alpha = service().create(() => {
			creationOrder.push("alpha");
			return { value: 40 };
		});

		const beta = service().create(({ services }) => {
			creationOrder.push("beta:start");
			const value = services.alpha.value + 2;
			creationOrder.push("beta:end");
			return { value };
		});

		const { app, cleanup } = await createServiceApp({ beta, alpha });
		try {
			const ctx = extractAppServices(app);
			expect((ctx.services as any).beta.value).toBe(42);
			expect(creationOrder).toEqual(["beta:start", "alpha", "beta:end"]);
		} finally {
			await cleanup();
		}
	});

	it("throws on circular singleton dependencies", async () => {
		const alpha = service().create(({ services }) => ({
			value: services.beta.value + 1,
		}));

		const beta = service().create(({ services }) => ({
			value: services.alpha.value + 1,
		}));

		await expect(createServiceApp({ alpha, beta })).rejects.toThrow(
			"Circular service dependency detected",
		);
	});

	it("awaits async singleton create() during app initialization", async () => {
		const asyncService = service().create(async () => {
			await Promise.resolve();
			return { ready: true };
		});

		const consumer = service().create(({ services }) => ({
			ready: services.asyncService.ready,
		}));

		const { app, cleanup } = await createServiceApp({ asyncService, consumer });
		try {
			const ctx = extractAppServices(app);
			expect((ctx.services as any).consumer.ready).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it("throws when async create() is lazily triggered", async () => {
		const asyncService = service().create(async () => ({ ready: true }));
		const consumer = service().create(({ services }) => ({
			ready: services.asyncService.ready,
		}));

		await expect(createServiceApp({ consumer, asyncService })).rejects.toThrow(
			'Service "asyncService" has async create() but was lazily triggered',
		);
	});

	it("places services by namespace in extracted AppContext", async () => {
		const blog = service().create(() => ({ kind: "blog" }));
		const workflows = service()
			.namespace(null)
			.create(() => ({ kind: "workflows" }));
		const tracker = service()
			.namespace("analytics")
			.create(() => ({ kind: "tracker" }));

		const { app, cleanup } = await createServiceApp({
			blog,
			workflows,
			tracker,
		});
		try {
			const ctx = extractAppServices(app);
			expect((ctx.services as any).blog.kind).toBe("blog");
			expect((ctx as any).workflows.kind).toBe("workflows");
			expect((ctx as any).analytics.tracker.kind).toBe("tracker");
			expect((ctx.services as any).workflows).toBeUndefined();
		} finally {
			await cleanup();
		}
	});

	it("app object exposes only singleton infrastructure, not user services", async () => {
		const myService = service()
			.lifecycle("singleton")
			.namespace("services")
			.create(() => ({ ok: true }));

		const { app, cleanup } = await createServiceApp({ myService });
		try {
			// The app object itself should NOT have user services as properties.
			// User services are only accessible via ctx (extractAppServices).
			expect(app).not.toHaveProperty("services");
			expect(app).not.toHaveProperty("myService");

			// Infrastructure singletons ARE on app
			expect(app).toHaveProperty("db");
			expect(app).toHaveProperty("queue");
			expect(app).toHaveProperty("email");
			expect(app).toHaveProperty("storage");
			expect(app).toHaveProperty("kv");
			expect(app).toHaveProperty("logger");
			expect(app).toHaveProperty("search");
			expect(app).toHaveProperty("realtime");
			expect(app).toHaveProperty("collections");
			expect(app).toHaveProperty("globals");

			// Services appear on ctx, not app
			const ctx = extractAppServices(app);
			expect(ctx).toHaveProperty("services");
			expect((ctx.services as any).myService).toEqual({ ok: true });
		} finally {
			await cleanup();
		}
	});

	it("throws when request-scoped service uses non-default namespace", async () => {
		const invalid = service()
			.lifecycle("request")
			.namespace("analytics")
			.create(() => ({}));

		await expect(createServiceApp({ invalid })).rejects.toThrow(
			"only singleton services may use custom namespaces",
		);
	});

	it("creates request-scoped services per context extraction", async () => {
		let sequence = 0;

		const requestOnly = service()
			.lifecycle("request")
			.create(({ session }) => ({
				id: ++sequence,
				userId: session?.user?.id ?? null,
			}));

		const { app, cleanup } = await createServiceApp({ requestOnly });
		try {
			const ctxA = extractAppServices(app, {
				session: { user: { id: "user-a" }, session: {} } as any,
			});
			const ctxB = extractAppServices(app, {
				session: { user: { id: "user-b" }, session: {} } as any,
			});

			expect((ctxA.services as any).requestOnly.id).toBe(1);
			expect((ctxB.services as any).requestOnly.id).toBe(2);
			expect((ctxA.services as any).requestOnly.userId).toBe("user-a");
			expect((ctxB.services as any).requestOnly.userId).toBe("user-b");
		} finally {
			await cleanup();
		}
	});

	it("disposes all singleton services on destroy", async () => {
		const disposed: string[] = [];

		const blog = service()
			.create(() => ({ ok: true }))
			.dispose(() => {
				disposed.push("blog");
			});

		const workflows = service()
			.namespace(null)
			.create(() => ({ ok: true }))
			.dispose(() => {
				disposed.push("workflows");
			});

		const requestOnly = service()
			.lifecycle("request")
			.create(() => ({ ok: true }))
			.dispose(() => {
				disposed.push("request-only");
			});

		const { app, cleanup } = await createServiceApp({
			blog,
			workflows,
			requestOnly,
		});
		try {
			await app.destroy();
			expect(disposed.sort()).toEqual(["blog", "workflows"]);
		} finally {
			await cleanup();
		}
	});

	it("disposes singleton services sequentially in reverse initialization order", async () => {
		const events: string[] = [];
		const first = service()
			.create(() => {
				events.push("first:create");
				return {};
			})
			.dispose(async () => {
				events.push("first:dispose:start");
				await Promise.resolve();
				events.push("first:dispose:end");
			});
		const second = service()
			.create(() => {
				events.push("second:create");
				return {};
			})
			.dispose(async () => {
				events.push("second:dispose:start");
				await Promise.resolve();
				events.push("second:dispose:end");
			});
		const { app, cleanup } = await createServiceApp({ first, second });
		await cleanup();

		expect(events).toEqual([
			"first:create",
			"second:create",
			"second:dispose:start",
			"second:dispose:end",
			"first:dispose:start",
			"first:dispose:end",
		]);
	});

	it("rolls back initialized singleton services when startup fails", async () => {
		const events: string[] = [];
		const ready = service()
			.create(() => {
				events.push("ready:create");
				return {};
			})
			.dispose(() => {
				events.push("ready:dispose");
			});
		const failing = service().create(() => {
			events.push("failing:create");
			throw new Error("startup failed");
		});

		await expect(createServiceApp({ ready, failing })).rejects.toThrow(
			"startup failed",
		);
		expect(events).toEqual(["ready:create", "failing:create", "ready:dispose"]);
	});

	it("rejects singleton dependencies on request-scoped services", async () => {
		const requestOnly = service()
			.lifecycle("request")
			.create(() => ({}));
		const singleton = service().create(({ services }) => ({
			requestOnly: services.requestOnly,
		}));

		await expect(createServiceApp({ requestOnly, singleton })).rejects.toThrow(
			"Singleton service cannot depend on request-scoped service",
		);
	});

	it("reuses and disposes request services in a standalone context", async () => {
		let created = 0;
		let disposed = 0;
		const child = service()
			.lifecycle("request")
			.create(() => ({ id: ++created }))
			.dispose(() => {
				disposed++;
			});
		const parent = service()
			.lifecycle("request")
			.create(({ services }) => ({ child: services.child }));
		const { app, cleanup } = await createServiceApp({ child, parent });
		try {
			await using context = await createContextFactory(app)();
			expect((context.services as any).child).toBe(
				(context.services as any).parent.child,
			);
			expect(created).toBe(1);
		} finally {
			await cleanup();
		}
		expect(disposed).toBe(1);
	});

	it("awaits CRDT shutdown before disposing realtime infrastructure", async () => {
		const events: string[] = [];
		const realtime = service()
			.namespace(null)
			.create(() => ({}))
			.dispose(async () => {
				events.push("realtime:start");
				await Promise.resolve();
				events.push("realtime:end");
			});
		const crdtOperations = service()
			.namespace(null)
			.create(() => ({}))
			.dispose(async () => {
				events.push("crdt:start");
				await Promise.resolve();
				events.push("crdt:end");
			});
		const { app, cleanup } = await createServiceApp({
			realtime,
			crdtOperations,
		});
		try {
			await app.destroy();
			expect(events).toEqual([
				"crdt:start",
				"crdt:end",
				"realtime:start",
				"realtime:end",
			]);
		} finally {
			await cleanup();
		}
	});
});
