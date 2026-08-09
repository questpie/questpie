import { afterEach, describe, expect, it } from "bun:test";

import { questpieElysia } from "../../../elysia/src/server.js";
import { questpieHono } from "../../../hono/src/server.js";
import { questpieNextRouteHandlers } from "../../../next/src/server.js";
import { collection, route, service } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import type { NativeAdapterConfig } from "../../src/server/adapters/types.js";
import type { SearchAdapter } from "../../src/server/modules/core/integrated/search/types.js";
import type { MockApp } from "../utils/mocks/mock-app-builder";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

type Dispatch = (request: Request) => Promise<Response | null>;

type HostHarness = Readonly<{
	name: "core Fetch" | "Next" | "Hono" | "Elysia";
	create(app: MockApp, options?: NativeAdapterConfig): Dispatch;
}>;

const HOSTS: readonly HostHarness[] = [
	{
		name: "core Fetch",
		create: (app, options) => createFetchHandler(app, options),
	},
	{
		name: "Next",
		create(app, options) {
			const handlers = questpieNextRouteHandlers(app, options);
			return (request) => handlers[request.method]!(request);
		},
	},
	{
		name: "Hono",
		create(app, options) {
			const adapter = questpieHono(app, options);
			return (request) => adapter.request(request);
		},
	},
	{
		name: "Elysia",
		create(app, options) {
			const adapter = questpieElysia(app, options);
			return (request) => adapter.handle(request);
		},
	},
] as const;

const METHODS = [
	"GET",
	"POST",
	"PUT",
	"PATCH",
	"DELETE",
	"OPTIONS",
	"HEAD",
] as const;

const methodRoutes = {
	"verbs/get": route()
		.get()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/post": route()
		.post()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/put": route()
		.put()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/patch": route()
		.patch()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/delete": route()
		.delete()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/options": route()
		.options()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"verbs/head": route()
		.head()
		.raw()
		.handler(({ request }) => observedMethod(request)),
	"method-only:GET": route()
		.get()
		.raw()
		.handler(() => new Response(null, { status: 204 })),
};

function observedMethod(request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: { "x-observed-method": request.method },
	});
}

function requestFor(method: string, path: string): Request {
	return new Request(`http://localhost${path}`, { method });
}

async function canonicalErrorBody(response: Response | null): Promise<unknown> {
	expect(response).toBeInstanceOf(Response);
	const text = await response!.text();
	try {
		return JSON.parse(text);
	} catch {
		return { nonJsonBody: text };
	}
}

async function waitFor(
	predicate: () => boolean,
	message: string,
): Promise<void> {
	const deadline = Date.now() + 1_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error(message);
		await Bun.sleep(0);
	}
}

function createSearchAdapter(): SearchAdapter {
	return {
		name: "conformance-search",
		capabilities: {
			lexical: true,
			trigram: false,
			semantic: false,
			hybrid: false,
			facets: false,
		},
		initialize: async () => {},
		getMigrations: () => [],
		search: async () => ({ results: [], total: 0, facets: [] }),
		index: async () => {},
		remove: async () => {},
		reindex: async () => {},
		clear: async () => {},
	};
}

describe("shared HTTP adapter conformance", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
	});

	async function setupApp(
		definition: Parameters<typeof buildMockApp>[0],
		runtime?: Parameters<typeof buildMockApp>[1],
	): Promise<MockApp> {
		const setup = await buildMockApp(definition, runtime);
		cleanups.push(setup.cleanup);
		return setup.app;
	}

	describe("base-path ownership", () => {
		it("fails handler construction when route patterns are ambiguous", async () => {
			const app = await setupApp({
				routes: {
					"ambiguous/[id]": route()
						.get()
						.raw()
						.handler(() => new Response("id")),
					"ambiguous/[slug]": route()
						.get()
						.raw()
						.handler(() => new Response("slug")),
				},
			});

			expect(() => createFetchHandler(app)).toThrow("Route collision");
		});

		it("core distinguishes exact, nested, sibling, and in-mount unknown paths", async () => {
			const app = await setupApp({ routes: methodRoutes });
			const dispatch = createFetchHandler(app, { basePath: "/api" });

			const exact = await dispatch(requestFor("GET", "/api"));
			const nested = await dispatch(requestFor("GET", "/api/verbs/get"));
			const sibling = await dispatch(requestFor("GET", "/apiary"));
			const unknown = await dispatch(requestFor("GET", "/api/x"));

			expect(exact?.status).toBe(404);
			expect(nested?.headers.get("x-observed-method")).toBe("GET");
			expect(sibling).toBeNull();
			expect(unknown?.status).toBe(404);
			expect(await canonicalErrorBody(exact)).toMatchObject({
				error: { code: "NOT_FOUND" },
			});
			expect(await canonicalErrorBody(unknown)).toMatchObject({
				error: { code: "NOT_FOUND" },
			});
		});

		for (const hostName of ["Hono", "Elysia"] as const) {
			it(`${hostName} owns the exact and nested mount without claiming its sibling`, async () => {
				const app = await setupApp({ routes: methodRoutes });
				const core = createFetchHandler(app, { basePath: "/api" });
				const expectedExact = await core(requestFor("GET", "/api"));
				const expectedUnknown = await core(requestFor("GET", "/api/x"));

				let dispatch: Dispatch;
				if (hostName === "Hono") {
					const native = questpieHono(app, { basePath: "/api" })
						.get("/before", (context) => context.text("before"))
						.get("/apiary", (context) => context.text("native sibling"))
						.get("/after", (context) => context.text("after"));
					dispatch = (request) => native.request(request);
				} else {
					const native = questpieElysia(app, { basePath: "/api" })
						.get("/before", () => "before")
						.get("/apiary", () => "native sibling")
						.get("/after", () => "after");
					dispatch = (request) => native.handle(request);
				}

				const exact = await dispatch(requestFor("GET", "/api"));
				const nested = await dispatch(requestFor("GET", "/api/verbs/get"));
				const sibling = await dispatch(requestFor("GET", "/apiary"));
				const unknown = await dispatch(requestFor("GET", "/api/x"));

				expect(exact?.status).toBe(expectedExact?.status);
				expect(await canonicalErrorBody(exact)).toEqual(
					await canonicalErrorBody(expectedExact),
				);
				expect(nested?.headers.get("x-observed-method")).toBe("GET");
				expect(await sibling?.text()).toBe("native sibling");
				expect(unknown?.status).toBe(expectedUnknown?.status);
				expect(await canonicalErrorBody(unknown)).toEqual(
					await canonicalErrorBody(expectedUnknown),
				);
				expect(
					await (await dispatch(requestFor("GET", "/before")))?.text(),
				).toBe("before");
				expect(
					await (await dispatch(requestFor("GET", "/after")))?.text(),
				).toBe("after");
			});
		}
	});

	describe("method transport", () => {
		for (const host of HOSTS) {
			it(`${host.name} transports all seven explicitly declared methods`, async () => {
				const app = await setupApp({ routes: methodRoutes });
				const dispatch = host.create(app, { basePath: "/api" });

				for (const method of METHODS) {
					const response = await dispatch(
						requestFor(method, `/api/verbs/${method.toLowerCase()}`),
					);
					expect(response?.status).toBe(204);
					expect(response?.headers.get("x-observed-method")).toBe(method);
				}
			});

			it(`${host.name} returns core 405 with an exact Allow header`, async () => {
				const app = await setupApp({ routes: methodRoutes });
				const response = await host.create(app, { basePath: "/api" })(
					requestFor("DELETE", "/api/method-only"),
				);

				expect(response?.status).toBe(405);
				expect(response?.headers.get("allow")).toBe("GET");
			});
		}
	});

	describe("authority and context", () => {
		for (const host of HOSTS) {
			it(`${host.name} resolves authority and extension context exactly once`, async () => {
				let sessionResolutions = 0;
				let localeResolutions = 0;
				let contextExtensions = 0;
				const inspect = route()
					.get()
					.raw()
					.handler(({ locale, session, organizationId }) =>
						Response.json({
							userId:
								(session?.user as { id?: string } | undefined)?.id ?? null,
							locale,
							organizationId,
						}),
					);
				const app = await setupApp({
					routes: { inspect },
					locale: {
						locales: [{ code: "en" }, { code: "sk" }],
						defaultLocale: "en",
					},
				});
				const dispatch = host.create(app, {
					basePath: "/api",
					getSession: async () => {
						sessionResolutions++;
						return {
							user: { id: "user-conformance" },
							session: { id: "session-conformance" },
						};
					},
					getLocale: () => {
						localeResolutions++;
						return "sk";
					},
					extendContext: () => {
						contextExtensions++;
						return { organizationId: "org-conformance" };
					},
				});

				const response = await dispatch(requestFor("GET", "/api/inspect"));

				expect(response?.status).toBe(200);
				expect(await response?.json()).toEqual({
					userId: "user-conformance",
					locale: "sk",
					organizationId: "org-conformance",
				});
				expect(sessionResolutions).toBe(1);
				expect(localeResolutions).toBe(1);
				expect(contextExtensions).toBe(1);
			});
		}
	});

	for (const host of HOSTS) {
		it(`${host.name} keeps search reindex policy local to concurrent handlers`, async () => {
			const posts = collection("posts")
				.fields(({ f }) => ({ title: f.text().required() }))
				.access({ read: true, update: false });
			const app = await setupApp(
				{ collections: { posts } },
				{ search: createSearchAdapter() },
			);
			const session = async () => ({
				user: { id: "editor", role: "editor" },
				session: { id: "editor-session" },
			});
			const allow = host.create(app, {
				getSession: session,
				search: { reindexAccess: true },
			});
			const deny = host.create(app, {
				getSession: session,
				search: { reindexAccess: false },
			});

			const [allowed, denied] = await Promise.all([
				allow(requestFor("POST", "/search/reindex/posts")),
				deny(requestFor("POST", "/search/reindex/posts")),
			]);

			expect(allowed?.status).toBe(200);
			expect(denied?.status).toBe(403);
		});
	}

	describe("stream request-scope lifetime", () => {
		for (const host of HOSTS) {
			it(`${host.name} disposes once on completion, cancellation, and abort`, async () => {
				let disposed = 0;
				const controllers: ReadableStreamDefaultController<Uint8Array>[] = [];
				const scoped = service()
					.lifecycle("request")
					.create(() => ({}))
					.dispose(() => {
						disposed++;
					});
				const stream = route()
					.get()
					.raw()
					.handler(({ services }) => {
						void services.scoped;
						return new Response(
							new ReadableStream<Uint8Array>({
								start(controller) {
									controllers.push(controller);
								},
							}),
						);
					});
				const app = await setupApp({
					routes: { stream },
					services: { scoped },
				});
				const dispatch = host.create(app, { basePath: "/api" });

				const completed = await dispatch(requestFor("GET", "/api/stream"));
				controllers[0]!.close();
				await completed?.arrayBuffer();
				expect(disposed).toBe(1);

				const cancelled = await dispatch(requestFor("GET", "/api/stream"));
				await cancelled?.body?.cancel("consumer cancelled");
				expect(disposed).toBe(2);

				const abort = new AbortController();
				const aborted = await dispatch(
					new Request("http://localhost/api/stream", { signal: abort.signal }),
				);
				abort.abort("client disconnected");
				await waitFor(
					() => disposed === 3,
					`${host.name} did not dispose the aborted request scope`,
				);
				await aborted?.body?.cancel();
				expect(disposed).toBe(3);
			});
		}
	});
});
