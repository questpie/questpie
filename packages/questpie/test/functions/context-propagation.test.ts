/**
 * Tests: context propagation in route handlers + normalizeContext
 *
 * Covers two bugs fixed:
 * 1. `executeJsonRoute` now wraps handler in `runWithContext` — locale/session
 *    propagate into nested CRUD calls without manual threading.
 * 2. `normalizeContext` now merges `session` from ALS — partial overrides like
 *    `{ accessMode: "user" }` inside a handler still carry the request session.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { createFetchHandler } from "../../src/server/adapters/http.js";
import { normalizeContext } from "../../src/server/collection/crud/shared/context.js";
import {
	runWithContext,
	tryGetContext,
} from "../../src/server/config/context.js";
import { route } from "../../src/exports/index.js";
import { executeJsonRoute } from "../../src/server/routes/execute.js";
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

	it("sets accessMode to 'system' inside handler regardless of request accessMode", async () => {
		let capturedAccessMode: string | undefined;

		const checkAccess = route()
			.post()
			.schema(z.object({}))
			.handler(async () => {
				const ctx = tryGetContext();
				capturedAccessMode = ctx?.accessMode;
				return {};
			});

		// Even though the request comes in as "user", handler body runs as "system"
		await executeJsonRoute(
			setup.app,
			checkAccess,
			{},
			{
				accessMode: "user",
			},
		);

		expect(capturedAccessMode).toBe("system");
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

	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		// Must register supported locales so createContext doesn't reject them
		setup = await buildMockApp({
			routes: { echoLocale },
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
