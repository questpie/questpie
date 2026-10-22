/**
 * Tests: context propagation in route handlers + normalizeContext
 *
 * Covers two bugs fixed:
 * 1. `executeJsonRoute` now wraps handler in `runWithContext` — locale/session
 *    propagate into nested CRUD calls without manual threading.
 * 2. Route execution now preserves request `accessMode` in ALS instead of
 *    silently escalating HTTP handlers to system mode.
 * 3. `normalizeContext` now merges `session` from ALS — partial overrides like
 *    `{ accessMode: "user" }` inside a handler still carry the request session.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { resolveContext } from "../../src/server/adapters/utils/context.js";
import { normalizeContext } from "../../src/server/collection/crud/shared/context.js";
import {
	runWithContext,
	tryGetContext,
} from "../../src/server/config/context.js";
import {
	executeJsonRoute,
	executeRawRoute,
} from "../../src/server/routes/execute.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

// ─────────────────────────────────────────────────────────────────────────────
// normalizeContext unit tests — no DB required
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeContext — ALS propagation", () => {
	it("uses defaults when no ALS scope is set", () => {
		const ctx = normalizeContext();
		expect(ctx.accessMode).toBe("system");
		expect(ctx.locale).toBe("en");
		expect(ctx.session).toBeUndefined();
	});

	it("inherits locale from ALS when not explicitly provided", async () => {
		await runWithContext({ app: {}, locale: "sk" }, async () => {
			const ctx = normalizeContext();
			expect(ctx.locale).toBe("sk");
		});
	});

	it("inherits session from ALS when not explicitly provided", async () => {
		const fakeSession = { user: { id: "u1" }, session: { id: "s1" } } as any;

		await runWithContext({ app: {}, session: fakeSession }, async () => {
			const ctx = normalizeContext();
			expect(ctx.session).toBe(fakeSession);
		});
	});

	it("explicit session overrides ALS session", async () => {
		const alsSession = { user: { id: "als" }, session: { id: "als-s" } } as any;
		const explicitSession = {
			user: { id: "explicit" },
			session: { id: "exp-s" },
		} as any;

		await runWithContext({ app: {}, session: alsSession }, async () => {
			const ctx = normalizeContext({ session: explicitSession });
			expect(ctx.session).toBe(explicitSession);
		});
	});

	it("partial override { accessMode: 'user' } still inherits ALS session", async () => {
		const fakeSession = { user: { id: "u1" }, session: { id: "s1" } } as any;

		await runWithContext(
			{ app: {}, session: fakeSession, locale: "de" },
			async () => {
				// Partial override — only accessMode changes
				const ctx = normalizeContext({ accessMode: "user" });
				expect(ctx.accessMode).toBe("user");
				// session and locale should come from ALS
				expect(ctx.session).toBe(fakeSession);
				expect(ctx.locale).toBe("de");
			},
		);
	});

	it("explicit locale overrides ALS locale", async () => {
		await runWithContext({ app: {}, locale: "sk" }, async () => {
			const ctx = normalizeContext({ locale: "en" });
			expect(ctx.locale).toBe("en");
		});
	});

	it("inherits stage from ALS", async () => {
		await runWithContext({ app: {}, stage: "draft" }, async () => {
			const ctx = normalizeContext();
			expect(ctx.stage).toBe("draft");
		});
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// executeJsonRoute context propagation — uses mock app but no DB interaction
// ─────────────────────────────────────────────────────────────────────────────

describe("executeJsonRoute — context propagation via runWithContext", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("sets locale in ALS so nested calls can inherit it", async () => {
		let capturedLocale: string | undefined;

		const getLocale = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				// Read ALS directly — simulates what normalizeContext does in nested CRUD
				const ctx = tryGetContext();
				capturedLocale = ctx?.locale;
				return {};
			});

		await executeJsonRoute(
			setup.app,
			getLocale,
			{},
			{
				locale: "sk",
				accessMode: "system",
			},
		);

		expect(capturedLocale).toBe("sk");
	});

	it("sets session in ALS so nested calls can inherit it", async () => {
		let capturedSession: unknown;

		const fakeSession = { user: { id: "u42" }, session: { id: "s42" } } as any;

		const getSession = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				const ctx = tryGetContext();
				capturedSession = ctx?.session;
				return {};
			});

		await executeJsonRoute(
			setup.app,
			getSession,
			{},
			{
				session: fakeSession,
				accessMode: "system",
			},
		);

		expect(capturedSession).toBe(fakeSession);
	});

	it("propagates accessMode from the execution context into handler ALS", async () => {
		let capturedAccessMode: string | undefined;

		const checkAccess = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				const ctx = tryGetContext();
				capturedAccessMode = ctx?.accessMode;
				return {};
			});

		await executeJsonRoute(
			setup.app,
			checkAccess,
			{},
			{
				accessMode: "user",
			},
		);

		expect(capturedAccessMode).toBe("user");
	});

	it("propagates stage into ALS", async () => {
		let capturedStage: string | undefined;

		const checkStage = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				const ctx = tryGetContext();
				capturedStage = ctx?.stage;
				return {};
			});

		await executeJsonRoute(
			setup.app,
			checkStage,
			{},
			{
				stage: "draft",
				accessMode: "system",
			},
		);

		expect(capturedStage).toBe("draft");
	});

	it("nested normalizeContext({ accessMode: 'user' }) auto-inherits session from ALS", async () => {
		const fakeSession = { user: { id: "u99" }, session: { id: "s99" } } as any;
		let capturedSession: unknown;

		const checkNestedSession = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				// Simulate what a nested CRUD call does internally:
				// developer passes { accessMode: "user" } and session should auto-merge
				const normalized = normalizeContext({ accessMode: "user" });
				capturedSession = normalized.session;
				return {};
			});

		await executeJsonRoute(
			setup.app,
			checkNestedSession,
			{},
			{
				session: fakeSession,
				locale: "en",
			},
		);

		expect(capturedSession).toBe(fakeSession);
	});

	it("does not synthesize a request for local JSON route execution", async () => {
		let capturedRequest: Request | undefined;

		const inspectRequest = route()
			.post()
			.schema(z.object({}))
			.outputSchema(z.object({ hasRequest: z.boolean() }))
			.handler(async ({ request }) => {
				capturedRequest = request;
				return { hasRequest: !!request };
			});

		const result = await executeJsonRoute(
			setup.app,
			inspectRequest,
			{},
			{
				accessMode: "system",
			},
		);

		expect(result.hasRequest).toBe(false);
		expect(capturedRequest).toBeUndefined();
	});

	it("passes verified context extensions flat to JSON handlers without replacing framework arguments", async () => {
		let policyRunId: unknown;
		const verified = {
			requesterRunId: "verified-run",
			input: { title: "extension input" },
			params: { taskId: "extension task" },
			app: "extension app",
			db: "extension db",
			accessMode: "system",
		};
		const rename = route()
			.post()
			.params<{ taskId: string }>()
			.schema(z.object({ title: z.string() }).strict())
			.access((args) => {
				policyRunId = Reflect.get(args, "requesterRunId");
				return true;
			})
			.handler((args) => {
				expect(args.app).toBe(setup.app);
				expect(args.db).toBe(setup.app.db);
				expect(args.accessMode).toBe("user");
				expect(args.params).toEqual({ taskId: "task-1" });
				return {
					title: args.input.title,
					requesterRunId: Reflect.get(args, "requesterRunId"),
				};
			});

		const result = await executeJsonRoute(
			setup.app,
			rename,
			{ title: "Renamed" },
			{ accessMode: "user", "~contextExtensions": verified },
			undefined,
			{ taskId: "task-1" },
		);

		expect(policyRunId).toBe("verified-run");
		expect(result).toEqual({
			title: "Renamed",
			requesterRunId: "verified-run",
		});
	});

	it("passes verified context extensions flat to raw handlers", async () => {
		const inspect = route()
			.post()
			.raw()
			.handler((args) =>
				Response.json({ requesterRunId: Reflect.get(args, "requesterRunId") }),
			);
		const response = await executeRawRoute(
			setup.app,
			inspect,
			new Request("http://localhost/inspect", { method: "POST" }),
			{
				accessMode: "user",
				"~contextExtensions": { requesterRunId: "verified-run" },
			},
		);

		expect(await response.json()).toEqual({ requesterRunId: "verified-run" });
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP adapter — locale propagates from request Accept-Language header
// ─────────────────────────────────────────────────────────────────────────────

describe("Route via HTTP — locale propagates from request into handler ALS", () => {
	const echoLocale = route()
		.post()
		.schema(z.object({}))
		.outputSchema(z.object({ locale: z.string().optional() }))
		.handler(async () => {
			const ctx = tryGetContext();
			return { locale: ctx?.locale };
		});
	const echoAccessMode = route()
		.post()
		.schema(z.object({}))
		.outputSchema(z.object({ accessMode: z.string().optional() }))
		.handler(async () => {
			const ctx = tryGetContext();
			return { accessMode: ctx?.accessMode };
		});
	const bridgeAdapterContext = route()
		.post()
		.raw()
		.handler(async ({ app, request }) => {
			const resolved = await resolveContext(app, request, {});
			return Response.json({
				accessMode: resolved.appContext.accessMode,
				organizationId:
					(resolved.appContext as { organizationId?: string }).organizationId ??
					null,
			});
		});
	const inspectPublicSurface = route()
		.post()
		.schema(z.object({}))
		.outputSchema(
			z.object({
				hasAdapterContext: z.boolean(),
				hasRequestContext: z.boolean(),
				symbolCount: z.number(),
			}),
		)
		.handler(async (ctx) => ({
			hasAdapterContext: "adapterContext" in ctx,
			hasRequestContext: "requestContext" in ctx,
			symbolCount: Object.getOwnPropertySymbols(ctx).length,
		}));

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		// Must register supported locales so createContext doesn't reject them
		setup = await buildMockApp({
			routes: {
				echoLocale,
				echoAccessMode,
				bridgeAdapterContext,
				inspectPublicSurface,
			},
			locale: {
				locales: [
					{ code: "en" },
					{ code: "fr" },
					{ code: "sk" },
					{ code: "de" },
				],
				defaultLocale: "en",
			},
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("handler reads locale from Accept-Language header via ALS", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/echo-locale", {
				method: "POST",
				headers: { "Accept-Language": "fr" },
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		const body = await response?.json();
		expect(body.locale).toBe("fr");
	});

	it("handler reads HTTP adapter accessMode via ALS", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/echo-access-mode", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		const body = await response?.json();
		expect(body.accessMode).toBe("user");
	});

	it("legacy handlers can reuse adapter context without public handler args", async () => {
		const handler = createFetchHandler(setup.app, {
			extendContext: async () => ({ organizationId: "org_123" }),
		});

		const response = await handler(
			new Request("http://localhost/bridge-adapter-context", {
				method: "POST",
			}),
		);

		expect(response?.status).toBe(200);
		const body = await response?.json();
		expect(body.accessMode).toBe("user");
		expect(body.organizationId).toBe("org_123");
	});

	it("does not expose adapter plumbing as route handler args", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/inspect-public-surface", {
				method: "POST",
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		const body = await response?.json();
		expect(body.hasAdapterContext).toBe(false);
		expect(body.hasRequestContext).toBe(false);
		expect(body.symbolCount).toBe(0);
	});

	it("different requests get their own locale (no ALS leak)", async () => {
		const handler = createFetchHandler(setup.app);

		const [r1, r2] = await Promise.all([
			handler(
				new Request("http://localhost/echo-locale", {
					method: "POST",
					headers: { "Accept-Language": "sk" },
					body: JSON.stringify({}),
				}),
			),
			handler(
				new Request("http://localhost/echo-locale", {
					method: "POST",
					headers: { "Accept-Language": "de" },
					body: JSON.stringify({}),
				}),
			),
		]);

		const b1 = await r1?.json();
		const b2 = await r2?.json();

		// Each request should have its own locale — no cross-request ALS leak
		const locales = new Set([b1.locale, b2.locale]);
		expect(locales.has("sk")).toBe(true);
		expect(locales.has("de")).toBe(true);
	});
});

describe("Route via HTTP — custom app context extensions reach JSON handlers", () => {
	const installApp = route()
		.post()
		.schema(z.object({}))
		.outputSchema(
			z.object({
				appId: z.string(),
				method: z.string(),
				organizationId: z.string().nullable(),
			}),
		)
		.handler(async (ctx) => {
			return {
				appId: ctx.params.appId,
				method: ctx.request?.method ?? "missing",
				organizationId:
					(ctx as { organizationId?: string | null }).organizationId ?? null,
			};
		});

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			routes: {
				"apps/[appId]/install": installApp,
			},
			config: {
				app: {
					context: async ({ request }) => ({
						organizationId: request.headers.get("x-org"),
					}),
				},
			},
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("passes request, params, and app-level context extensions into JSON handlers", async () => {
		const handler = createFetchHandler(setup.app);

		const response = await handler(
			new Request("http://localhost/apps/app_123/install", {
				method: "POST",
				headers: { "x-org": "org_456" },
				body: JSON.stringify({}),
			}),
		);

		expect(response?.status).toBe(200);
		const body = await response?.json();
		expect(body).toEqual({
			appId: "app_123",
			method: "POST",
			organizationId: "org_456",
		});
	});
});

describe("Route via HTTP — framework arguments win over colliding context extensions", () => {
	const seen: Record<string, Record<string, unknown>> = {};
	// `app` is never an extension here, so it is the framework reference.
	// `app.collections` builds a new object per read, so it cannot match by identity.
	const capture = (slot: string, args: Record<string, unknown>) => {
		const app = args.app as Record<string, unknown>;
		seen[slot] = {
			db: args.db === app.db,
			collections: typeof args.collections === "object",
			logger: args.logger === app.logger,
			requesterRunId: args.requesterRunId,
		};
	};
	const inspectJson = route()
		.post()
		.schema(z.object({}))
		.access((args) => {
			capture("jsonAccess", args as never);
			return true;
		})
		.handler((args) => {
			capture("jsonHandler", args as never);
			return {};
		});
	const inspectRaw = route()
		.post()
		.raw()
		.access((args) => {
			capture("rawAccess", args as never);
			return true;
		})
		.handler((args) => {
			capture("rawHandler", args as never);
			return new Response(null, { status: 204 });
		});

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			routes: { inspectJson, inspectRaw },
			config: {
				app: {
					context: async () => ({
						db: "extension db",
						collections: "extension collections",
						logger: "extension logger",
						requesterRunId: "verified-run",
					}),
				},
			},
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("keeps framework services in access rules and handlers while passing other extension keys", async () => {
		const handler = createFetchHandler(setup.app);
		for (const path of ["/inspect-json", "/inspect-raw"]) {
			const response = await handler(
				new Request(`http://localhost${path}`, { method: "POST", body: "{}" }),
			);
			expect(response?.status).toBeLessThan(300);
		}

		const framework = {
			db: true,
			collections: true,
			logger: true,
			requesterRunId: "verified-run",
		};
		expect(seen).toEqual({
			jsonAccess: framework,
			jsonHandler: framework,
			rawAccess: framework,
			rawHandler: framework,
		});
	});
});
