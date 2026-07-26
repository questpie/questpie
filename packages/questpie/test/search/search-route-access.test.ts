import { afterEach, describe, expect, it, setDefaultTimeout } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { searchSearch } from "../../src/server/adapters/routes/search.js";
import type {
	AdapterInitContext,
	AdapterMigration,
	IndexParams,
	RemoveParams,
	SearchAdapter,
	SearchOptions,
	SearchResponse,
} from "../../src/server/modules/core/integrated/search/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

setDefaultTimeout(60000);

class ResponseSearchAdapter implements SearchAdapter {
	readonly name = "response-test";
	readonly capabilities = {
		lexical: true,
		trigram: false,
		semantic: false,
		hybrid: false,
		facets: true,
	};

	constructor(private readonly response: SearchResponse) {}

	async initialize(_ctx: AdapterInitContext): Promise<void> {}
	getMigrations(): AdapterMigration[] {
		return [];
	}
	async search(_options: SearchOptions): Promise<SearchResponse> {
		return this.response;
	}
	async index(_params: IndexParams): Promise<void> {}
	async remove(_params: RemoveParams): Promise<void> {}
	async reindex(_collection: string): Promise<void> {}
	async clear(): Promise<void> {}
}

const session = {
	user: { id: "user-1", email: "user@example.com" },
	session: { id: "session-1", userId: "user-1" },
};

function request(body: Record<string, unknown>): Request {
	return new Request("http://localhost/search", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-tenant": "tenant-a",
		},
		body: JSON.stringify(body),
	});
}

describe("Search HTTP authorization and hydration", () => {
	let cleanup: (() => Promise<void>) | undefined;

	afterEach(async () => {
		await cleanup?.();
		cleanup = undefined;
	});

	it("passes the complete request authority context to collection read access", async () => {
		let observed: Record<string, unknown> | undefined;
		const posts = collection("posts")
			.fields(({ f }) => ({ title: f.text(255) }))
			.searchable({})
			.access({
				read: (ctx) => {
					observed = {
						session: ctx.session,
						principal: ctx.principal,
						actor: ctx.actor,
						request: ctx.request,
						tenant: (ctx as { tenant?: string }).tenant,
					};
					return true;
				},
			});
		const setup = await buildMockApp(
			{
				collections: { posts },
				config: {
					app: {
						context: async ({ request: incoming }) => ({
							tenant: incoming.headers.get("x-tenant"),
							actor: { kind: "human" as const, subjectId: "user-1" },
						}),
					},
				},
			},
			{
				search: new ResponseSearchAdapter({ results: [], total: 0 }),
			},
		);
		cleanup = setup.cleanup;

		const incoming = request({ query: "post" });
		const response = await searchSearch(setup.app, incoming, {}, undefined, {
			getSession: async () => session,
		});

		expect(response.status).toBe(200);
		expect(observed?.session).toEqual(session);
		expect(observed?.principal).toMatchObject({
			kind: "user",
			user: { id: "user-1" },
		});
		expect(observed?.actor).toEqual({
			kind: "human",
			subjectId: "user-1",
		});
		expect(observed?.request).toBe(incoming);
		expect(observed?.tenant).toBe("tenant-a");
	});

	it("fails the whole response when an adapter candidate cannot be hydrated", async () => {
		const posts = collection("posts")
			.fields(({ f }) => ({ title: f.text(255) }))
			.searchable({})
			.access({ read: true });
		const setup = await buildMockApp(
			{ collections: { posts } },
			{
				search: new ResponseSearchAdapter({
					results: [
						{
							id: "search-1",
							collection: "posts",
							recordId: "missing-post",
							score: 1,
							title: "Stale",
							metadata: {},
							locale: "en",
							updatedAt: new Date(),
						},
					],
					total: 1,
				}),
			},
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);

		const response = await searchSearch(
			setup.app,
			request({ query: "stale" }),
			{},
		);

		expect(response.status).toBe(500);
		const body = (await response.json()) as {
			error?: { code?: string };
		};
		expect(body.error?.code).toBe("INTERNAL_SERVER_ERROR");
	});

	it("does not expose implicitly configured collections to the adapter", async () => {
		let observedCollections: string[] | undefined;
		class RecordingAdapter extends ResponseSearchAdapter {
			override async search(options: SearchOptions): Promise<SearchResponse> {
				observedCollections = options.collections;
				return { results: [], total: 0 };
			}
		}
		const implicit = collection("implicit").fields(({ f }) => ({
			title: f.text(255),
		}));
		const explicit = collection("explicit")
			.fields(({ f }) => ({ title: f.text(255) }))
			.searchable({});
		const setup = await buildMockApp(
			{ collections: { implicit, explicit }, defaultAccess: { read: true } },
			{
				search: new RecordingAdapter({ results: [], total: 0 }),
			},
		);
		cleanup = setup.cleanup;

		const response = await searchSearch(
			setup.app,
			request({ query: "post" }),
			{},
		);

		expect(response.status).toBe(200);
		expect(observedCollections).toEqual(["explicit"]);
	});

	it("does not expose index snapshots for fields hidden by field access", async () => {
		const posts = collection("posts")
			.fields(({ f }) => ({
				title: f.text(255).required(),
				secret: f.text(255).access({
					read: false,
					create: false,
					update: false,
				}),
			}))
			.searchable({})
			.access({ read: true, create: true });
		const adapterResponse: SearchResponse = { results: [], total: 1 };
		const setup = await buildMockApp(
			{ collections: { posts } },
			{ search: new ResponseSearchAdapter(adapterResponse) },
		);
		cleanup = setup.cleanup;
		await runTestDbMigrations(setup.app);

		const post = await setup.app.collections.posts.create(
			{ title: "Visible", secret: "classified-index-value" },
			{ accessMode: "system" },
		);
		adapterResponse.results.push({
			id: "search-1",
			collection: "posts",
			recordId: post.id,
			score: 0.9,
			title: "classified-index-value",
			content: "classified-index-value",
			highlights: {
				title: "<mark>classified-index-value</mark>",
				content: "<mark>classified-index-value</mark>",
			},
			metadata: {},
			locale: "en",
			updatedAt: new Date(),
		});

		const response = await searchSearch(
			setup.app,
			request({ query: "classified-index-value", highlights: true }),
			{},
		);

		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			docs: Array<Record<string, unknown>>;
		};
		expect(body.docs).toHaveLength(1);
		expect(body.docs[0]?.secret).toBeUndefined();
		expect(body.docs[0]?._search).toEqual({ score: 0.9 });
		expect(JSON.stringify(body)).not.toContain("classified-index-value");
	});
});
