/**
 * Request-context extensions (appConfig({ context })) — the resolver result
 * must travel with the request to every ctx assembly:
 *
 * - collection access rules (where-building read, create)
 * - hook ctx (beforeChange/afterChange, collections + globals)
 * - getContext() (ALS store)
 * - global access rules
 * - route access rules + route handlers
 * - field access rules
 * - transitionStage access rules
 * - nested CRUD triggered from hooks (ALS inheritance)
 * - explicit-context programmatic calls
 *
 * Lifecycle: resolver runs exactly once per request (single derivation point
 * in app.createContext), request-level memoization is plain closure scope,
 * non-HTTP contexts skip the resolver entirely.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, global, route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import {
	getContext,
	runWithContext,
	tryGetContext,
} from "../../src/server/config/context.js";
import { ApiError } from "../../src/server/errors/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

// ── Spies (reset per test) ──────────────────────────────────────────────────

const spy = {
	resolverRuns: 0,
	memoLookups: 0,
	resolverCollectionsWorked: false as boolean,
	readRuleTenant: undefined as unknown,
	createRuleTenant: undefined as unknown,
	beforeChangeTenant: undefined as unknown,
	getContextTenant: undefined as unknown,
	globalReadTenant: undefined as unknown,
	transitionRuleTenant: undefined as unknown,
	nestedHookTenant: undefined as unknown,
	memoValueInRule: undefined as unknown,
	memoValueInHook: undefined as unknown,
};

function resetSpy() {
	spy.resolverRuns = 0;
	spy.memoLookups = 0;
	spy.resolverCollectionsWorked = false;
	spy.readRuleTenant = undefined;
	spy.createRuleTenant = undefined;
	spy.beforeChangeTenant = undefined;
	spy.getContextTenant = undefined;
	spy.globalReadTenant = undefined;
	spy.transitionRuleTenant = undefined;
	spy.nestedHookTenant = undefined;
	spy.memoValueInRule = undefined;
	spy.memoValueInHook = undefined;
}

// ── App definition ──────────────────────────────────────────────────────────

const notes = collection("notes")
	.fields(({ f }) => ({
		title: f.text().required(),
		tenant: f.text(),
		secret: f.text(),
	}))
	.access({
		read: (ctx) => {
			const tenantId = (ctx as any).tenantId as string | null | undefined;
			spy.readRuleTenant = tenantId;
			spy.memoValueInRule = (ctx as any).expensiveTenant?.();
			return tenantId ? { tenant: tenantId } : false;
		},
		create: (ctx) => {
			spy.createRuleTenant = (ctx as any).tenantId;
			return !!(ctx as any).tenantId;
		},
		update: true,
		delete: true,
		fields: {
			secret: {
				read: (ctx) => (ctx as any).tenantId === "tenant-a",
			},
		},
	})
	.hooks({
		beforeChange: async ({ data, operation, ...ctx }) => {
			if (operation !== "create") return;
			spy.beforeChangeTenant = (ctx as any).tenantId;
			spy.memoValueInHook = (ctx as any).expensiveTenant?.();
			if (!data.tenant) data.tenant = (ctx as any).tenantId;
		},
		afterChange: async ({ data, operation, ...ctx }) => {
			if (operation !== "create") return;
			spy.getContextTenant = (getContext() as any).tenantId;
			// Nested CRUD without explicit context — inherits extensions via ALS
			await (ctx as any).collections.audit_logs.create({
				title: `created:${data.title}`,
			});
		},
	});

const audit_logs = collection("audit_logs")
	.fields(({ f }) => ({
		title: f.text().required(),
		tenant: f.text(),
	}))
	.access({ read: true, create: true, update: true, delete: true })
	.hooks({
		beforeChange: async ({ data, ...ctx }) => {
			spy.nestedHookTenant = (ctx as any).tenantId;
			if (!data.tenant) data.tenant = (ctx as any).tenantId;
		},
	});

const wf_docs = collection("wf_docs")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	})
	.access({
		read: true,
		create: true,
		update: true,
		delete: true,
		transition: (ctx) => {
			spy.transitionRuleTenant = (ctx as any).tenantId;
			return (ctx as any).tenantId === "tenant-a";
		},
	});

const tenant_settings = global("tenant_settings")
	.fields(({ f }) => ({
		motto: f.text(),
	}))
	.access({
		read: (ctx) => {
			spy.globalReadTenant = (ctx as any).tenantId;
			return (ctx as any).tenantId === "tenant-a";
		},
		update: true,
	});

const whoami = route()
	.post()
	.schema(z.object({}))
	.access((ctx) => !!(ctx as any).tenantId)
	.handler(async (ctx) => ({
		tenantId: (ctx as any).tenantId ?? null,
	}));

function tenantResolver({ request, collections }: any) {
	spy.resolverRuns += 1;
	const tenantId = request.headers.get("x-tenant");

	// Resolver gets the system-mode service surface (collections, …)
	const probe = (collections as any)?.notes
		? (collections as any).notes
				.count({})
				.then((count: unknown) => {
					spy.resolverCollectionsWorked = typeof count === "number";
				})
				.catch(() => {})
		: Promise.resolve();

	// Request-level memoization = plain closure scope
	let memo: string | null = null;
	const expensiveTenant = () => {
		if (memo === null) {
			spy.memoLookups += 1;
			memo = `resolved:${tenantId ?? "anon"}`;
		}
		return memo;
	};

	return probe.then(() => ({ tenantId: tenantId || null, expensiveTenant }));
}

function request(
	path: string,
	options: { method?: string; tenant?: string; body?: unknown } = {},
) {
	return new Request(`http://localhost${path}`, {
		method: options.method ?? "GET",
		headers: {
			"content-type": "application/json",
			...(options.tenant ? { "x-tenant": options.tenant } : {}),
		},
		...(options.body !== undefined
			? { body: JSON.stringify(options.body) }
			: {}),
	});
}

describe("request context extensions (appConfig({ context }))", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let handler: ReturnType<typeof createFetchHandler>;

	beforeEach(async () => {
		resetSpy();
		setup = await buildMockApp({
			collections: { notes, audit_logs, wf_docs },
			globals: { tenant_settings },
			routes: { whoami },
			config: { app: { context: tenantResolver } },
		});
		await runTestDbMigrations(setup.app);
		handler = createFetchHandler(setup.app);

		// Seed data in system mode (no request → resolver must not run)
		await setup.app.collections.notes.create({
			title: "a-note",
			tenant: "tenant-a",
		});
		await setup.app.collections.notes.create({
			title: "a-note-2",
			tenant: "tenant-a",
			secret: "classified",
		});
		await setup.app.collections.notes.create({
			title: "b-note",
			tenant: "tenant-b",
			secret: "b-classified",
		});
		expect(spy.resolverRuns).toBe(0);
		resetSpy();
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("collection access rule sees the resolved context and filters rows", async () => {
		const response = await handler(request("/notes", { tenant: "tenant-a" }));
		expect(response?.status).toBe(200);
		const body = await response?.json();

		expect(spy.readRuleTenant).toBe("tenant-a");
		expect(body.docs).toHaveLength(2);
		expect(body.docs.every((d: any) => d.tenant === "tenant-a")).toBe(true);
	});

	it("denies reads when the resolver yields no tenant", async () => {
		const response = await handler(request("/notes"));
		expect(spy.readRuleTenant).toBeNull();
		expect(response?.status).toBe(403);
	});

	it("field access rule sees the resolved context", async () => {
		const allowed = await handler(request("/notes", { tenant: "tenant-a" }));
		const allowedDocs = (await allowed!.json()).docs;
		const withSecret = allowedDocs.find((d: any) => d.title === "a-note-2");
		expect(withSecret.secret).toBe("classified");

		const denied = await handler(request("/notes", { tenant: "tenant-b" }));
		const deniedDocs = (await denied!.json()).docs;
		expect(deniedDocs).toHaveLength(1);
		expect(deniedDocs[0].secret).toBeUndefined();
	});

	it("hooks see extensions; getContext() exposes them; nested CRUD inherits via ALS", async () => {
		const response = await handler(
			request("/notes", {
				method: "POST",
				tenant: "tenant-a",
				body: { title: "hooked" },
			}),
		);
		expect(response?.status).toBe(200);
		const created = await response?.json();

		// create access rule + beforeChange hook saw the extension
		expect(spy.createRuleTenant).toBe("tenant-a");
		expect(spy.beforeChangeTenant).toBe("tenant-a");
		// beforeChange auto-assigned the tenant from resolved context
		expect(created.tenant).toBe("tenant-a");
		// getContext() inside afterChange saw the extension (ALS path)
		expect(spy.getContextTenant).toBe("tenant-a");
		// nested CRUD (audit_logs.create from afterChange) inherited extensions
		expect(spy.nestedHookTenant).toBe("tenant-a");

		const audits = await setup.app.collections.audit_logs.find({
			where: { title: "created:hooked" },
		});
		expect(audits.docs).toHaveLength(1);
		expect(audits.docs[0].tenant).toBe("tenant-a");
	});

	it("global access rule sees the resolved context", async () => {
		const allowed = await handler(
			request("/globals/tenant_settings", { tenant: "tenant-a" }),
		);
		expect(spy.globalReadTenant).toBe("tenant-a");
		expect(allowed?.status).toBe(200);

		const denied = await handler(
			request("/globals/tenant_settings", { tenant: "tenant-b" }),
		);
		expect(denied?.status).toBe(403);
	});

	it("route access rule and handler see the resolved context", async () => {
		const denied = await handler(
			request("/whoami", { method: "POST", body: {} }),
		);
		expect(denied?.status).toBe(403);

		const allowed = await handler(
			request("/whoami", { method: "POST", tenant: "tenant-a", body: {} }),
		);
		expect(allowed?.status).toBe(200);
		expect(await allowed?.json()).toEqual({ tenantId: "tenant-a" });
	});

	it("transitionStage access rule sees the resolved context", async () => {
		const doc = await setup.app.collections.wf_docs.create({ title: "wf" });

		const ctxA = await setup.app.createContext({
			request: request("/", { tenant: "tenant-a" }),
		});
		await setup.app.collections.wf_docs.transitionStage(
			{ id: doc.id, stage: "published" },
			ctxA,
		);
		expect(spy.transitionRuleTenant).toBe("tenant-a");

		const ctxB = await setup.app.createContext({
			request: request("/", { tenant: "tenant-b" }),
		});
		await expect(
			setup.app.collections.wf_docs.transitionStage(
				{ id: doc.id, stage: "draft" },
				ctxB,
			),
		).rejects.toThrow(/permission/i);
	});

	it("explicit-context programmatic calls carry extensions (no HTTP adapter)", async () => {
		const ctx = await setup.app.createContext({
			request: request("/", { tenant: "tenant-a" }),
		});
		expect(ctx.accessMode).toBe("user");
		expect((ctx as any).tenantId).toBe("tenant-a");
		expect(ctx["~contextExtensions"]).toMatchObject({ tenantId: "tenant-a" });

		const result = await setup.app.collections.notes.find({}, ctx);
		expect(spy.readRuleTenant).toBe("tenant-a");
		expect(result.docs).toHaveLength(2);
	});

	it("resolver runs exactly once per request (rules + hooks + nested CRUD)", async () => {
		await handler(
			request("/notes", {
				method: "POST",
				tenant: "tenant-a",
				body: { title: "once" },
			}),
		);
		expect(spy.resolverRuns).toBe(1);

		await handler(request("/notes", { tenant: "tenant-a" }));
		expect(spy.resolverRuns).toBe(2);
	});

	it("closure memo executes the underlying lookup once per request", async () => {
		await handler(
			request("/notes", {
				method: "POST",
				tenant: "tenant-a",
				body: { title: "memoized" },
			}),
		);

		// read in create-rule (no) + beforeChange hook; find-rule not hit on POST
		expect(spy.memoValueInHook).toBe("resolved:tenant-a");
		expect(spy.memoLookups).toBe(1);

		await handler(request("/notes", { tenant: "tenant-a" }));
		expect(spy.memoValueInRule).toBe("resolved:tenant-a");
		// fresh request → fresh closure → one more lookup
		expect(spy.memoLookups).toBe(2);
	});

	it("resolver receives the system-mode service surface (collections)", async () => {
		await handler(request("/notes", { tenant: "tenant-a" }));
		expect(spy.resolverCollectionsWorked).toBe(true);
	});

	it("non-HTTP createContext() skips the resolver — extensions absent", async () => {
		const ctx = await setup.app.createContext();
		expect(spy.resolverRuns).toBe(0);
		expect((ctx as any).tenantId).toBeUndefined();
		expect(ctx["~contextExtensions"]).toBeUndefined();
	});

	it("createContext() is idempotent — re-entry does not re-run the resolver", async () => {
		const ctx = await setup.app.createContext({
			request: request("/", { tenant: "tenant-a" }),
		});
		expect(spy.resolverRuns).toBe(1);

		const reentered = await setup.app.createContext(ctx as any);
		expect(spy.resolverRuns).toBe(1);
		expect((reentered as any).tenantId).toBe("tenant-a");
	});
});

describe("request context extensions — system resolver boundary", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const observations: Array<{
		accessMode: string | undefined;
		principalKind: string | undefined;
		session: unknown;
		ambientDb: unknown;
		resolverDb: unknown;
		locale: string | undefined;
		stage: string | undefined;
		requestId: string | undefined;
		traceId: string | undefined;
		staleExtension: unknown;
	}> = [];

	beforeEach(async () => {
		observations.length = 0;
		const protectedMemberships = collection("protected_memberships")
			.fields(({ f }) => ({ userId: f.text().required() }))
			.access({ read: false, create: false, update: false, delete: false });
		setup = await buildMockApp({
			collections: { protectedMemberships },
			locale: {
				defaultLocale: "en",
				locales: [{ code: "en" }, { code: "sk" }],
			},
			config: {
				app: {
					context: async ({ collections, db, request, session }: any) => {
						const ambient = tryGetContext();
						observations.push({
							accessMode: ambient?.accessMode,
							principalKind: ambient?.principal?.kind,
							session: ambient?.session,
							ambientDb: ambient?.db,
							resolverDb: db,
							locale: ambient?.locale,
							stage: ambient?.stage,
							requestId: ambient?.requestId,
							traceId: ambient?.traceId,
							staleExtension: ambient?.["~contextExtensions"]?.stale,
						});
						const count = await collections.protectedMemberships.count({});
						if (request.headers.get("x-reject") === "yes") {
							throw ApiError.unauthorized("Resolver rejected the request");
						}
						return {
							hasMembership: count === 1 && session?.user.id === "user-1",
						};
					},
				},
			},
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.protectedMemberships.create({
			userId: "user-1",
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("isolates resolver services from ambient user ALS and restores the caller", async () => {
		const session = {
			user: { id: "user-1" },
			session: { id: "session-1" },
		};
		const principal = {
			kind: "user" as const,
			user: session.user,
			session: session.session,
		};
		const outer = {
			app: setup.app,
			session,
			principal: principal as any,
			db: setup.app.db,
			locale: "sk",
			accessMode: "user",
			stage: "review",
			requestId: "request-1",
			traceId: "trace-1",
			"~contextExtensions": { stale: "must-not-leak" },
		};

		const resolved = await runWithContext(outer, async () => {
			const context = await setup.app.createContext({
				request: new Request("http://localhost/context"),
				session,
				principal: principal as any,
				db: setup.app.db,
				locale: "sk",
				accessMode: "user",
				stage: "review",
				requestId: "request-1",
				traceId: "trace-1",
			});
			expect(tryGetContext()?.principal).toBe(principal);
			expect(tryGetContext()?.accessMode).toBe("user");
			return context;
		});

		expect(observations[0]).toEqual({
			accessMode: "system",
			principalKind: "system",
			session,
			ambientDb: setup.app.db,
			resolverDb: setup.app.db,
			locale: "sk",
			stage: "review",
			requestId: "request-1",
			traceId: "trace-1",
			staleExtension: undefined,
		});
		expect(resolved).toMatchObject({
			session,
			principal,
			accessMode: "user",
			locale: "sk",
			stage: "review",
			requestId: "request-1",
			traceId: "trace-1",
			hasMembership: true,
		});
		expect(resolved["~contextExtensions"]).toEqual({
			hasMembership: true,
		});

		await runWithContext(outer, async () => {
			await expect(
				setup.app.createContext({
					request: new Request("http://localhost/context", {
						headers: { "x-reject": "yes" },
					}),
					session,
					principal: principal as any,
					db: setup.app.db,
					locale: "sk",
					accessMode: "user",
					stage: "review",
					requestId: "request-1",
					traceId: "trace-1",
				}),
			).rejects.toThrow("Resolver rejected the request");
			expect(tryGetContext()?.principal).toBe(principal);
			expect(tryGetContext()?.accessMode).toBe("user");
		});
	});
});

describe("request context extensions — reserved keys", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				items: collection("items").fields(({ f }) => ({
					name: f.text().required(),
				})),
			},
			config: {
				app: {
					context: async () => ({
						session: "shadow-attempt",
						db: "shadow-attempt",
						tenantId: "ok",
					}),
				},
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("warns about reserved keys and never shadows framework context keys", async () => {
		const ctx = await setup.app.createContext({
			request: new Request("http://localhost/"),
		});

		const warnings = setup.app.mocks.logger.getLogsContaining("reserved key");
		expect(warnings.length).toBeGreaterThanOrEqual(2);

		// Framework keys win — resolver cannot shadow them
		expect(ctx.session).not.toBe("shadow-attempt");
		expect(ctx.db).toBe(setup.app.db);
		// Non-reserved keys still land
		expect((ctx as any).tenantId).toBe("ok");

		// Warning fires once per key per app instance
		await setup.app.createContext({
			request: new Request("http://localhost/"),
		});
		expect(
			setup.app.mocks.logger.getLogsContaining("reserved key").length,
		).toBe(warnings.length);
	});
});

describe("request context extensions — failing resolver", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ruleRan: boolean;

	beforeEach(async () => {
		ruleRan = false;
		setup = await buildMockApp({
			collections: {
				items: collection("items")
					.fields(({ f }) => ({ name: f.text().required() }))
					.access({
						read: () => {
							ruleRan = true;
							return true;
						},
					}),
			},
			config: {
				app: {
					context: async () => {
						throw ApiError.unauthorized("Tenant validation failed");
					},
				},
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("fails the request before any access rule runs", async () => {
		const handler = createFetchHandler(setup.app);
		const response = await handler(new Request("http://localhost/items"));

		expect(response?.status).toBe(401);
		expect(ruleRan).toBe(false);
	});
});
