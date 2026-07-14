// @ts-nocheck // TODO: Temporary until test utils are fully typed
import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { lt } from "drizzle-orm";

import {
	createAdapterRoutes,
	collection,
	global,
	questpieRealtimeLogTable,
	type RealtimeAdapter,
	type RealtimeChangeEvent,
} from "../../src/exports/index.js";
import { sharedSseKeepAliveTicker } from "../../src/server/modules/core/integrated/realtime/sse-keep-alive.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ============================================================================
// Test Utilities
// ============================================================================

class MockRealtimeAdapter implements RealtimeAdapter {
	public notices: Array<{ seq: number; resource: string; operation: string }> =
		[];
	private listeners = new Set<(notice: any) => void>();

	async start(): Promise<void> {}
	async stop(): Promise<void> {}

	subscribe(handler: (notice: any) => void): () => void {
		this.listeners.add(handler);
		return () => {
			this.listeners.delete(handler);
		};
	}

	async notify(event: RealtimeChangeEvent): Promise<void> {
		const notice = {
			seq: event.seq,
			resource: event.resource,
			operation: event.operation,
		};
		this.notices.push(notice);
		for (const listener of this.listeners) {
			listener(notice);
		}
	}
}

class LifecycleTrackingRealtimeAdapter extends MockRealtimeAdapter {
	public readonly started: Promise<void>;
	public startCalls = 0;
	public stopCalls = 0;
	private markStarted: () => void = () => {};

	constructor() {
		super();
		this.started = new Promise((resolve) => {
			this.markStarted = resolve;
		});
	}

	async start(): Promise<void> {
		this.startCalls += 1;
		this.markStarted();
	}

	async stop(): Promise<void> {
		this.stopCalls += 1;
	}
}

class FailingStartRealtimeAdapter extends MockRealtimeAdapter {
	async start(): Promise<void> {
		throw new Error("adapter start failed");
	}
}

type SSEEvent = {
	event: string;
	data: any;
	comment?: string;
};

type TopicInput = {
	id: string;
	resourceType: "collection" | "global";
	resource: string;
	operation?: "find" | "count" | "get";
	recordId?: string;
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
	sinceSeq?: number;
};

/**
 * Create a POST request for the unified realtime endpoint
 */
const createRealtimeRequest = (
	topics: TopicInput[],
	signal?: AbortSignal,
): Request => {
	return new Request("http://localhost/realtime", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ topics }),
		signal,
	});
};

/**
 * Helper to create a collection topic
 */
const collectionTopic = (
	collection: string,
	options?: Omit<TopicInput, "id" | "resourceType" | "resource">,
): TopicInput => ({
	id: `col-${collection}`,
	resourceType: "collection",
	resource: collection,
	...options,
});

/**
 * Helper to create a global topic
 */
const globalTopic = (
	globalName: string,
	options?: Omit<TopicInput, "id" | "resourceType" | "resource">,
): TopicInput => ({
	id: `global-${globalName}`,
	resourceType: "global",
	resource: globalName,
	...options,
});

const createSSEReader = (stream: ReadableStream<Uint8Array>) => {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	const readEvent = async (
		timeoutMs = 2000,
		includeSession = false,
	): Promise<SSEEvent> => {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const separatorIndex = buffer.indexOf("\n\n");
			if (separatorIndex !== -1) {
				const chunk = buffer.slice(0, separatorIndex);
				buffer = buffer.slice(separatorIndex + 2);

				let event = "message";
				let data = "";
				let comment: string | undefined;
				for (const line of chunk.split("\n")) {
					if (line.startsWith("event:")) {
						event = line.slice(6).trim();
					} else if (line.startsWith("data:")) {
						data += line.slice(5).trim();
					} else if (line.startsWith(":")) {
						comment = line.slice(1).trim();
					}
				}

				const parsed = {
					event,
					data: data ? JSON.parse(data) : null,
					comment,
				};
				if (parsed.event === "session" && !includeSession) continue;
				return parsed;
			}

			const { value, done } = await reader.read();
			if (done) {
				throw new Error("SSE stream closed before event");
			}
			buffer += decoder.decode(value, { stream: true });
		}

		throw new Error("Timed out waiting for SSE event");
	};

	const readSnapshot = async (
		timeoutMs = 2000,
		topicId?: string,
	): Promise<SSEEvent> => {
		while (true) {
			const event = await readEvent(timeoutMs);
			if (event.comment !== undefined) {
				continue;
			}
			// If topicId specified, filter by it
			if (topicId && event.data?.topicId !== topicId) {
				continue;
			}
			return event;
		}
	};

	return { readEvent, readSnapshot, close: () => reader.cancel() };
};

// ============================================================================
// Test Suite
// ============================================================================

describe("realtime", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		if (setup) {
			await setup.cleanup();
			// setup = null;
		}
	});

	// ==========================================================================
	// Operation-aware topic tests
	// ==========================================================================

	describe("operation-aware topics", () => {
		it("streams live count as an O(1) scalar without running find", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts")
				.fields(({ f }) => ({
					title: f.textarea().required(),
				}))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { posts } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const context = createTestContext();
			for (let index = 0; index < 32; index += 1) {
				await setup.app.collections.posts.create(
					{ title: `Post ${index}` },
					context,
				);
			}

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([
					collectionTopic("posts", { operation: "count" }),
				]),
				{},
				undefined,
			);
			expect(response.status).toBe(200);
			const reader = createSSEReader(response.body!);

			const initial = await reader.readSnapshot();
			expect(initial.data.data).toBe(32);
			expect(JSON.stringify(initial.data.data).length).toBeLessThan(16);

			await setup.app.collections.posts.create({ title: "Post 32" }, context);
			const updated = await reader.readSnapshot();
			expect(updated.data.data).toBe(33);
			expect(JSON.stringify(updated.data.data).length).toBeLessThan(16);
			await reader.close();
		});

		it("rejects invalid operation and query-shape combinations", async () => {
			const posts = collection("posts")
				.fields(({ f }) => ({ title: f.textarea().required() }))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { posts } },
				{ realtime: true },
			);
			await runTestDbMigrations(setup.app);
			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });

			const countWithFindLimit = await routes.realtime.subscribe(
				createRealtimeRequest([
					collectionTopic("posts", { operation: "count", limit: 1 }),
				]),
				{},
				undefined,
			);
			expect(countWithFindLimit.status).toBe(400);

			const unknownOperation = await routes.realtime.subscribe(
				createRealtimeRequest([
					collectionTopic("posts", { operation: "delete" as any }),
				]),
				{},
				undefined,
			);
			expect(unknownOperation.status).toBe(400);
		});
	});

	// ==========================================================================
	// Core Logging Tests
	// ==========================================================================

	describe("change logging", () => {
		it("logs realtime changes for create/update/delete", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required().localized(),
				slug: f.textarea().required(),
			}));

			const testModule = {
				collections: { posts },
				locale: {
					locales: [{ code: "en" }, { code: "sk" }],
					defaultLocale: "en",
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctxEn = createTestContext({ locale: "en", defaultLocale: "en" });
			const ctxSk = createTestContext({ locale: "sk", defaultLocale: "en" });

			const created = await setup.app.collections.posts.create(
				{ title: "Hello", slug: "hello" },
				ctxEn,
			);
			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { title: "Ahoj" } },
				ctxSk,
			);
			await setup.app.collections.posts.deleteById({ id: created.id }, ctxEn);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.orderBy(questpieRealtimeLogTable.seq);

			expect(logs.length).toBe(3);
			expect(logs[0].operation).toBe("create");
			expect(logs[1].operation).toBe("update");
			expect(logs[1].locale).toBe("sk");
			expect(logs[2].operation).toBe("delete");

			expect(adapter.notices.length).toBe(3);
			expect(adapter.notices.map((n) => n.operation)).toEqual([
				"create",
				"update",
				"delete",
			]);
		});

		it("logs bulk update/delete operations", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				slug: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					posts,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);
			const ctx = createTestContext();

			const first = await setup.app.collections.posts.create(
				{ title: "One", slug: "one" },
				ctx,
			);
			const second = await setup.app.collections.posts.create(
				{ title: "Two", slug: "two" },
				ctx,
			);

			await setup.app.collections.posts.update(
				{ where: { id: { in: [first.id, second.id] } }, data: { slug: "new" } },
				ctx,
			);
			await setup.app.collections.posts.delete(
				{ where: { id: { in: [first.id, second.id] } } },
				ctx,
			);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.orderBy(questpieRealtimeLogTable.seq);

			const bulkOps = logs.map((row: any) => row.operation);
			expect(bulkOps).toContain("bulk_update");
			expect(bulkOps).toContain("bulk_delete");
		});

		it("includes payload in realtime events", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.textarea().required(),
				metadata: f.json(),
			}));

			const testModule = {
				collections: {
					posts,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: RealtimeChangeEvent[] = [];

			const unsub = setup.app.realtime?.subscribe((event) =>
				events.push(event),
			);

			await setup.app.collections.posts.create(
				{
					title: "Hello",
					status: "published",
					metadata: { nested: { value: "not-routing-data" } },
				},
				ctx,
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			expect(events[0].payload).toBeDefined();
			expect(events[0].payload?.before).toBeNull();
			expect(events[0].payload?.after).toMatchObject({
				title: "Hello",
				status: "published",
			});
			expect(events[0].payload?.after).not.toHaveProperty("metadata");

			unsub?.();
		});
	});

	// ==========================================================================
	// WHERE Filter Tests
	// ==========================================================================

	describe("WHERE filtering", () => {
		it("only notifies subscribers with matching WHERE filter", async () => {
			const adapter = new MockRealtimeAdapter();
			const messages = collection("messages").fields(({ f }) => ({
				chatId: f.textarea().required(),
				content: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					messages,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const chat1Events: any[] = [];
			const chat2Events: any[] = [];
			const allEvents: any[] = [];

			const unsub1 = setup.app.realtime?.subscribe(
				(event) => chat1Events.push(event),
				{
					resourceType: "collection",
					resource: "messages",
					where: { chatId: "chat1" },
				},
			);

			const unsub2 = setup.app.realtime?.subscribe(
				(event) => chat2Events.push(event),
				{
					resourceType: "collection",
					resource: "messages",
					where: { chatId: "chat2" },
				},
			);

			const unsub3 = setup.app.realtime?.subscribe(
				(event) => allEvents.push(event),
				{ resourceType: "collection", resource: "messages" },
			);

			await setup.app.collections.messages.create(
				{ chatId: "chat1", content: "Hello chat1" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(chat1Events.length).toBe(1);
			expect(chat2Events.length).toBe(0);
			expect(allEvents.length).toBe(1);

			await setup.app.collections.messages.create(
				{ chatId: "chat2", content: "Hello chat2" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(chat1Events.length).toBe(1);
			expect(chat2Events.length).toBe(1);
			expect(allEvents.length).toBe(2);

			unsub1?.();
			unsub2?.();
			unsub3?.();
		});

		it("handles complex WHERE filters with multiple fields", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				status: f.textarea().required(),
				authorId: f.textarea().required(),
				title: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					posts,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "posts",
					where: { status: "published", authorId: "author1" },
				},
			);

			// Wrong status
			await setup.app.collections.posts.create(
				{ status: "draft", authorId: "author1", title: "Draft" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(0);

			// Wrong author
			await setup.app.collections.posts.create(
				{ status: "published", authorId: "author2", title: "By Author 2" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(0);

			// Both match
			await setup.app.collections.posts.create(
				{
					status: "published",
					authorId: "author1",
					title: "Published by Author 1",
				},
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			const after = events[0].payload?.after as Record<string, unknown>;
			expect(after.status).toBe("published");
			expect(after.authorId).toBe("author1");

			unsub?.();
		});

		it("refreshes create events for complex OR filters", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.textarea().required(),
				authorId: f.textarea().required(),
			}));

			const testModule = { collections: { posts } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "posts",
					where: {
						OR: [{ status: "published" }, { authorId: "author-1" }],
					},
				},
			);

			await setup.app.collections.posts.create(
				{ title: "Matches OR", status: "draft", authorId: "author-1" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			expect(events[0].operation).toBe("create");

			unsub?.();
		});

		it("conservatively refreshes create for complex filters", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.textarea().required(),
			}));

			const testModule = { collections: { posts } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "posts",
					where: {
						OR: [{ status: "published" }, { status: "scheduled" }],
					},
				},
			);

			await setup.app.collections.posts.create(
				{ title: "Draft", status: "draft" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			expect(events[0].operation).toBe("create");

			unsub?.();
		});

		it("filters by boolean fields", async () => {
			const adapter = new MockRealtimeAdapter();
			const tasks = collection("tasks").fields(({ f }) => ({
				title: f.textarea().required(),
				completed: f.boolean().required().default(false),
			}));

			const testModule = {
				collections: {
					tasks,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const completedEvents: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => completedEvents.push(event),
				{
					resourceType: "collection",
					resource: "tasks",
					where: { completed: true },
				},
			);

			// Create incomplete task
			await setup.app.collections.tasks.create(
				{ title: "Todo", completed: false },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(completedEvents.length).toBe(0);

			// Create completed task
			await setup.app.collections.tasks.create(
				{ title: "Done", completed: true },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(completedEvents.length).toBe(1);

			unsub?.();
		});

		it("filters by numeric fields", async () => {
			const adapter = new MockRealtimeAdapter();
			const products = collection("products").fields(({ f }) => ({
				name: f.textarea().required(),
				categoryId: f.number().required(),
			}));

			const testModule = {
				collections: {
					products,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const category1Events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => category1Events.push(event),
				{
					resourceType: "collection",
					resource: "products",
					where: { categoryId: 1 },
				},
			);

			await setup.app.collections.products.create(
				{ name: "Product A", categoryId: 2 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(category1Events.length).toBe(0);

			await setup.app.collections.products.create(
				{ name: "Product B", categoryId: 1 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(category1Events.length).toBe(1);

			unsub?.();
		});

		it("supports wildcard collection subscriptions", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
			}));
			const comments = collection("comments").fields(({ f }) => ({
				content: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					posts,
					comments,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const allEvents: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => allEvents.push(event),
				{ resourceType: "collection", resource: "*" },
			);

			await setup.app.collections.posts.create({ title: "Post 1" }, ctx);
			await setup.app.collections.comments.create(
				{ content: "Comment 1" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(allEvents.length).toBe(2);
			expect(allEvents.map((e) => e.resource).sort()).toEqual([
				"comments",
				"posts",
			]);

			unsub?.();
		});

		it("re-sends snapshot when record leaves filter on update", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.textarea().required(),
			}));

			const testModule = { collections: { posts } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const filteredEvents: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => filteredEvents.push(event),
				{
					resourceType: "collection",
					resource: "posts",
					where: { status: "published" },
				},
			);

			const post = await setup.app.collections.posts.create(
				{ title: "Published post", status: "published" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(filteredEvents.length).toBe(1);

			filteredEvents.length = 0;

			await setup.app.collections.posts.updateById(
				{ id: post.id, data: { status: "draft" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(filteredEvents.length).toBe(1);
			expect(filteredEvents[0].operation).toBe("update");

			filteredEvents.length = 0;
			await setup.app.collections.posts.updateById(
				{ id: post.id, data: { status: "archived" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(filteredEvents).toHaveLength(0);

			unsub?.();
		});

		it("re-sends snapshot for filtered subscriber on delete", async () => {
			const adapter = new MockRealtimeAdapter();
			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				status: f.textarea().required(),
			}));

			const testModule = { collections: { posts } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const filteredEvents: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => filteredEvents.push(event),
				{
					resourceType: "collection",
					resource: "posts",
					where: { status: "published" },
				},
			);

			const post = await setup.app.collections.posts.create(
				{ title: "To delete", status: "published" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(filteredEvents.length).toBe(1);

			filteredEvents.length = 0;

			await setup.app.collections.posts.deleteById({ id: post.id }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(filteredEvents.length).toBe(1);
			expect(filteredEvents[0].operation).toBe("delete");

			unsub?.();
		});
	});

	// ==========================================================================
	// WITH Dependency Tests
	// ==========================================================================

	describe("WITH dependency tracking", () => {
		it("notifies subscribers when related resource changes", async () => {
			const adapter = new MockRealtimeAdapter();
			const users = collection("users")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true, create: true, update: true, delete: true });

			const messages = collection("messages")
				.fields(({ f }) => ({
					chatId: f.textarea().required(),
					content: f.textarea().required(),
					user: f.relation("users").required().relationName("user"),
				}))
				.access({ read: true, create: true, update: true, delete: true });

			const testModule = {
				collections: {
					users,
					messages,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();
			const request = createRealtimeRequest(
				[collectionTopic("messages", { with: { user: true } })],
				controller.signal,
			);
			const response = await routes.realtime.subscribe(request, {}, undefined);
			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);
			const initial = await reader.readSnapshot();
			expect(initial.event).toBe("snapshot");

			const ctx = createTestContext();
			const user = await setup.app.collections.users.create(
				{ name: "Alice" },
				ctx,
			);
			await setup.app.collections.messages.create(
				{ chatId: "chat1", content: "Hello", user: user.id }, // FK column key is field name with unified API
				ctx,
			);

			let snapshot = await reader.readSnapshot();
			while (snapshot.data.data.docs.length === 0) {
				snapshot = await reader.readSnapshot();
			}
			expect(snapshot.data.data.docs[0].user.name).toBe("Alice");

			// Update the user - should trigger refresh
			await setup.app.collections.users.updateById(
				{ id: user.id, data: { name: "Alice Smith" } },
				ctx,
			);

			let updatedSnapshot = await reader.readSnapshot();
			while (updatedSnapshot.data.data.docs[0]?.user?.name !== "Alice Smith") {
				updatedSnapshot = await reader.readSnapshot();
			}
			expect(updatedSnapshot.data.data.docs[0].user.name).toBe("Alice Smith");

			controller.abort();
			reader.close();
		});

		it("handles nested WITH relations (comments -> posts -> users)", async () => {
			const adapter = new MockRealtimeAdapter();
			const users = collection("users").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const posts = collection("posts").fields(({ f }) => ({
				title: f.textarea().required(),
				user: f.relation("users").required().relationName("user"),
			}));

			const comments = collection("comments").fields(({ f }) => ({
				content: f.textarea().required(),
				post: f.relation("posts").required().relationName("post"),
			}));

			const testModule = {
				collections: {
					users,
					posts,
					comments,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const user = await setup.app.collections.users.create(
				{ name: "Bob" },
				ctx,
			);
			const post = await setup.app.collections.posts.create(
				{ title: "Post 1", user: user.id }, // FK column key is field name with unified API
				ctx,
			);
			const comment = await setup.app.collections.comments.create(
				{ content: "Nice post!", post: post.id }, // FK column key is field name with unified API
				ctx,
			);

			const events: any[] = [];

			// Subscribe with nested WITH
			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "comments",
					with: { post: { with: { user: true } } },
				},
			);

			await new Promise((resolve) => setTimeout(resolve, 100));
			events.length = 0;

			// Update comment directly
			await setup.app.collections.comments.updateById(
				{ id: comment.id, data: { content: "Updated comment" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("comments");
			events.length = 0;

			// Update post (first level relation)
			await setup.app.collections.posts.updateById(
				{ id: post.id, data: { title: "Updated Post" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("posts");
			events.length = 0;

			// Update user (deeply nested relation)
			await setup.app.collections.users.updateById(
				{ id: user.id, data: { name: "Bob Builder" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("users");

			unsub?.();
		});

		it("service-level WITH dependency tracking", async () => {
			const adapter = new MockRealtimeAdapter();
			const categories = collection("categories").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const products = collection("products").fields(({ f }) => ({
				name: f.textarea().required(),
				category: f.relation("categories").required().relationName("category"),
			}));

			const testModule = {
				collections: {
					categories,
					products,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const category = await setup.app.collections.categories.create(
				{ name: "Electronics" },
				ctx,
			);
			await setup.app.collections.products.create(
				{ name: "Phone", category: category.id }, // FK column key is field name with unified API
				ctx,
			);

			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "products",
					with: { category: true },
				},
			);

			await new Promise((resolve) => setTimeout(resolve, 100));
			events.length = 0;

			// Update category should trigger product subscriber
			await setup.app.collections.categories.updateById(
				{ id: category.id, data: { name: "Consumer Electronics" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("categories");

			unsub?.();
		});
	});

	// ==========================================================================
	// Global Subscriptions
	// ==========================================================================

	describe("global subscriptions", () => {
		it("reuses one resolved global CRUD across topics", async () => {
			const adapter = new MockRealtimeAdapter();
			const settings = global("settings")
				.fields(({ f }) => ({ title: f.textarea() }))
				.access({ read: true, update: true });

			setup = await buildMockApp(
				{ globals: { settings } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const generateCrud = spyOn(
				setup.app.getGlobalConfig("settings"),
				"generateCRUD",
			);
			const controller = new AbortController();
			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const firstTopic = globalTopic("settings");
			const response = await routes.realtime.subscribe(
				createRealtimeRequest(
					[firstTopic, { ...firstTopic, id: "global-settings-second" }],
					controller.signal,
				),
				{},
				undefined,
			);
			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);

			await reader.readSnapshot();
			await reader.readSnapshot();
			expect(generateCrud).toHaveBeenCalledTimes(1);

			controller.abort();
			reader.close();
			generateCrud.mockRestore();
		});

		it("re-sends snapshots when global changes", async () => {
			const adapter = new MockRealtimeAdapter();
			const settings = global("settings")
				.fields(({ f }) => ({ title: f.textarea() }))
				.access({ read: true, update: true });

			const testModule = {
				globals: {
					settings,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();
			const request = createRealtimeRequest(
				[globalTopic("settings")],
				controller.signal,
			);
			const response = await routes.realtime.subscribe(request, {}, undefined);

			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);
			const initial = await reader.readSnapshot();
			expect(initial.event).toBe("snapshot");

			const ctx = createTestContext();
			await setup.app.globals.settings.update({ title: "New Title" }, ctx);

			let updatedSnapshot = await reader.readSnapshot();
			while (updatedSnapshot.data.data?.title !== "New Title") {
				updatedSnapshot = await reader.readSnapshot();
			}
			expect(updatedSnapshot.data.data.title).toBe("New Title");

			controller.abort();
			reader.close();
		});

		it("global subscriptions with WITH referencing collections", async () => {
			const adapter = new MockRealtimeAdapter();
			const categories = collection("categories")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true, create: true, update: true, delete: true });

			const settings = global("settings")
				.fields(({ f }) => ({
					siteName: f.textarea(),
					defaultCategory: f
						.relation("categories")
						.relationName("defaultCategory"),
				}))
				.access({ read: true, update: true });

			const testModule = {
				collections: { categories },
				globals: { settings },
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();
			const request = createRealtimeRequest(
				[globalTopic("settings", { with: { defaultCategory: true } })],
				controller.signal,
			);
			const response = await routes.realtime.subscribe(request, {}, undefined);
			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);
			const initial = await reader.readSnapshot();
			expect(initial.event).toBe("snapshot");

			const ctx = createTestContext();
			const category = await setup.app.collections.categories.create(
				{ name: "Tech" },
				ctx,
			);
			await setup.app.globals.settings.update(
				{ siteName: "My Site", defaultCategory: category.id },
				ctx,
			);

			let snapshot = await reader.readSnapshot();
			while (!snapshot.data.data?.defaultCategory?.name) {
				snapshot = await reader.readSnapshot();
			}
			expect(snapshot.data.data.defaultCategory.name).toBe("Tech");

			// Update category should trigger settings refresh
			await setup.app.collections.categories.updateById(
				{ id: category.id, data: { name: "Technology" } },
				ctx,
			);

			let updatedSnapshot = await reader.readSnapshot();
			while (
				updatedSnapshot.data.data?.defaultCategory?.name !== "Technology"
			) {
				updatedSnapshot = await reader.readSnapshot();
			}
			expect(updatedSnapshot.data.data.defaultCategory.name).toBe("Technology");

			controller.abort();
			reader.close();
		});
	});

	// ==========================================================================
	// Edge Cases
	// ==========================================================================

	describe("edge cases", () => {
		it("isolates a throwing listener so later listeners still receive the event", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			let healthyListenerCalls = 0;
			setup.app.realtime.subscribe(
				() => {
					throw new Error("listener failed");
				},
				{ resourceType: "collection", resource: "items" },
			);
			setup.app.realtime.subscribe(
				() => {
					healthyListenerCalls += 1;
				},
				{ resourceType: "collection", resource: "items" },
			);

			const event: RealtimeChangeEvent = {
				seq: 1,
				resourceType: "collection",
				resource: "items",
				operation: "create",
				payload: { before: null, after: { name: "Safe" } },
				createdAt: new Date(),
			};

			expect(() => setup.app.realtime.emit(event)).not.toThrow();
			expect(healthyListenerCalls).toBe(1);
			expect(
				setup.app.mocks.logger.getLogsContaining("Realtime listener failed"),
			).toHaveLength(1);
		});

		it("keeps adapter running until app teardown", async () => {
			const adapter = new LifecycleTrackingRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const testModule = { collections: { items } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const firstUnsub = setup.app.realtime?.subscribe(() => {}, {
				resourceType: "collection",
				resource: "items",
			});
			await adapter.started;
			expect(adapter.startCalls).toBe(1);

			firstUnsub?.();
			await Promise.resolve();
			expect(adapter.stopCalls).toBe(0);

			const secondUnsub = setup.app.realtime?.subscribe(() => {}, {
				resourceType: "collection",
				resource: "items",
			});
			await Promise.resolve();
			expect(adapter.startCalls).toBe(1);

			secondUnsub?.();
			await setup.app.realtime.getLatestSeq();
			await setup.cleanup();
			expect(adapter.stopCalls).toBe(1);
		});

		it("handles multiple subscribers with different filters", async () => {
			const adapter = new MockRealtimeAdapter();
			const orders = collection("orders").fields(({ f }) => ({
				status: f.textarea().required(),
				customerId: f.textarea().required(),
				total: f.number().required(),
			}));

			const testModule = {
				collections: {
					orders,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const pendingEvents: any[] = [];
			const customer1Events: any[] = [];
			const allEvents: any[] = [];

			const unsub1 = setup.app.realtime?.subscribe(
				(e) => pendingEvents.push(e),
				{
					resourceType: "collection",
					resource: "orders",
					where: { status: "pending" },
				},
			);

			const unsub2 = setup.app.realtime?.subscribe(
				(e) => customer1Events.push(e),
				{
					resourceType: "collection",
					resource: "orders",
					where: { customerId: "c1" },
				},
			);

			const unsub3 = setup.app.realtime?.subscribe((e) => allEvents.push(e), {
				resourceType: "collection",
				resource: "orders",
			});

			// Pending order for customer 1 - should trigger all 3
			await setup.app.collections.orders.create(
				{ status: "pending", customerId: "c1", total: 100 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(pendingEvents.length).toBe(1);
			expect(customer1Events.length).toBe(1);
			expect(allEvents.length).toBe(1);

			// Completed order for customer 2 - should trigger only all
			await setup.app.collections.orders.create(
				{ status: "completed", customerId: "c2", total: 200 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(pendingEvents.length).toBe(1);
			expect(customer1Events.length).toBe(1);
			expect(allEvents.length).toBe(2);

			unsub1?.();
			unsub2?.();
			unsub3?.();
		});

		it("properly cleans up subscriptions", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					items,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe((e) => events.push(e), {
				resourceType: "collection",
				resource: "items",
			});

			await setup.app.collections.items.create({ name: "Item 1" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);

			// Unsubscribe
			unsub?.();

			// Should not receive this event
			await setup.app.collections.items.create({ name: "Item 2" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1); // Still 1
		});

		it("handles empty WHERE filter (matches all)", async () => {
			const adapter = new MockRealtimeAdapter();
			const logs = collection("logs").fields(({ f }) => ({
				message: f.textarea().required(),
			}));

			const testModule = {
				collections: {
					logs,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe((e) => events.push(e), {
				resourceType: "collection",
				resource: "logs",
				where: {},
			});

			await setup.app.collections.logs.create({ message: "Log 1" }, ctx);
			await setup.app.collections.logs.create({ message: "Log 2" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(2);

			unsub?.();
		});

		it("scales filtered routing across many subscribers", async () => {
			const adapter = new MockRealtimeAdapter();
			const messages = collection("messages").fields(({ f }) => ({
				roomId: f.textarea().required(),
				content: f.textarea().required(),
			}));

			const testModule = { collections: { messages } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const subscriberCount = 120;
			const rooms = 12;
			const targetRoom = "room-7";
			const hits = Array.from({ length: subscriberCount }, () => 0);

			const unsubscribers: Array<() => void> = [];
			for (let i = 0; i < subscriberCount; i++) {
				const roomId = `room-${i % rooms}`;
				const unsub = setup.app.realtime?.subscribe(
					() => {
						hits[i] += 1;
					},
					{
						resourceType: "collection",
						resource: "messages",
						where: { roomId },
					},
				);

				if (unsub) unsubscribers.push(unsub);
			}

			await setup.app.collections.messages.create(
				{ roomId: targetRoom, content: "hello" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 150));

			const targetHits = hits
				.filter((_, i) => `room-${i % rooms}` === targetRoom)
				.reduce((sum, value) => sum + value, 0);
			const nonTargetHits = hits
				.filter((_, i) => `room-${i % rooms}` !== targetRoom)
				.reduce((sum, value) => sum + value, 0);

			expect(targetHits).toBe(subscriberCount / rooms);
			expect(nonTargetHits).toBe(0);

			for (const unsub of unsubscribers) {
				unsub();
			}
		});

		it("cleans up old realtime log rows with retentionDays", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const testModule = { collections: { items } };

			setup = await buildMockApp(testModule, {
				realtime: { adapter, retentionDays: 1 },
			});
			await runTestDbMigrations(setup.app);

			const oldCreatedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
			await setup.app.db.insert(questpieRealtimeLogTable).values({
				resourceType: "collection",
				resource: "items",
				operation: "create",
				recordId: "old-record",
				locale: null,
				payload: { name: "old" },
				createdAt: oldCreatedAt,
			});

			const ctx = createTestContext();
			await setup.app.collections.items.create({ name: "new" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 150));

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.orderBy(questpieRealtimeLogTable.seq);

			const hasOldRow = logs.some((row: any) => row.recordId === "old-record");
			expect(hasOldRow).toBe(false);
			expect(logs.some((row: any) => row.payload?.after?.name === "new")).toBe(
				true,
			);
		});

		it("cleans up old rows by default with no subscribers", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			await setup.app.db.insert(questpieRealtimeLogTable).values({
				resourceType: "collection",
				resource: "items",
				operation: "create",
				recordId: "expired-headless-row",
				createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
			});

			await setup.app.realtime.cleanupOutbox(true);

			const logs = await setup.app.db.select().from(questpieRealtimeLogTable);
			expect(logs).toHaveLength(0);
		});

		it("does not delete rows from a local subscriber watermark", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items").fields(({ f }) => ({
				name: f.textarea().required(),
			}));

			const testModule = { collections: { items } };

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			await setup.app.db.insert(questpieRealtimeLogTable).values({
				resourceType: "collection",
				resource: "items",
				operation: "create",
				recordId: "pre-existing",
				locale: null,
				payload: { name: "before-subscribe" },
			});

			const events: RealtimeChangeEvent[] = [];
			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "items",
				},
			);

			const ctx = createTestContext();
			await setup.app.collections.items.create(
				{ name: "after-subscribe" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 150));

			expect(events.length).toBe(1);

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.orderBy(questpieRealtimeLogTable.seq);

			expect(logs.some((row: any) => row.recordId === "pre-existing")).toBe(
				true,
			);
			expect(
				logs.some((row: any) => row.payload?.after?.name === "after-subscribe"),
			).toBe(true);

			unsub?.();
		});
	});

	// ==========================================================================
	// Access Control Tests
	// ==========================================================================

	describe("access control", () => {
		it("rejects an anonymous denial before hooks, listeners, or a sink", async () => {
			const adapter = new LifecycleTrackingRealtimeAdapter();
			let beforeOperationRuns = 0;
			let beforeReadRuns = 0;
			const secrets = collection("secrets")
				.fields(({ f }) => ({
					content: f.textarea().required(),
					level: f.textarea().required(),
				}))
				.hooks({
					beforeOperation: () => void (beforeOperationRuns += 1),
					beforeRead: () => void (beforeReadRuns += 1),
				})
				.access({
					read: ({ session }) => Boolean(session),
					create: true,
				});

			const testModule = {
				collections: {
					secrets,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const request = createRealtimeRequest([collectionTopic("secrets")]);

			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({
						accessMode: "user",
						session: null,
					}),
				},
			);

			expect(response.ok).toBe(false);
			expect(beforeOperationRuns).toBe(0);
			expect(beforeReadRuns).toBe(0);
			expect(setup.app.realtime.listeners.size).toBe(0);
			expect(sharedSseKeepAliveTicker.size).toBe(0);
		});

		it("should allow access for authorized users", async () => {
			const adapter = new MockRealtimeAdapter();
			const secrets = collection("secrets")
				.fields(({ f }) => ({
					content: f.textarea().required(),
					level: f.textarea().required(),
				}))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
					create: true,
				});

			const testModule = {
				collections: {
					secrets,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();

			// Admin should get successful snapshot
			const request = createRealtimeRequest(
				[collectionTopic("secrets")],
				controller.signal,
			);

			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({ accessMode: "user", role: "admin" }),
				},
			);

			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);
			const initial = await reader.readSnapshot();

			expect(initial.event).toBe("snapshot");
			expect(initial.data.data).toBeDefined();

			controller.abort();
			reader.close();
		});

		it("removes a denied topic while keeping authorized topics alive", async () => {
			const adapter = new LifecycleTrackingRealtimeAdapter();
			const secrets = collection("secrets")
				.fields(({ f }) => ({ content: f.textarea().required() }))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
				});
			const posts = collection("posts")
				.fields(({ f }) => ({ title: f.textarea().required() }))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { secrets, posts } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([
					collectionTopic("secrets"),
					collectionTopic("posts"),
				]),
				{},
				{
					appContext: createTestContext({ accessMode: "user", role: "user" }),
				},
			);
			const reader = createSSEReader(response.body!);
			const initialEvents = [
				await reader.readEvent(),
				await reader.readEvent(),
			];

			expect(initialEvents).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						event: "error",
						data: expect.objectContaining({ topicId: "col-secrets" }),
					}),
					expect.objectContaining({
						event: "snapshot",
						data: expect.objectContaining({ topicId: "col-posts" }),
					}),
				]),
			);
			expect(setup.app.realtime.listeners.size).toBe(1);
			expect(adapter.stopCalls).toBe(0);

			await reader.close();
		});

		it("should filter payload fields based on field-level access", async () => {
			const adapter = new MockRealtimeAdapter();
			const documents = collection("documents")
				.fields(({ f }) => ({
					title: f.textarea().required(),
					content: f.textarea().required(),
					internalNotes: f.textarea().required(),
				}))
				.access({
					read: true,
					create: true,
					fields: {
						internalNotes: {
							read: ({ session }) => (session?.user as any)?.role === "admin",
						},
					},
				});

			const testModule = {
				collections: {
					documents,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext({ accessMode: "user", role: "user" });
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => events.push(event),
				{
					resourceType: "collection",
					resource: "documents",
				},
			);

			// Create document with all fields
			await setup.app.collections.documents.create(
				{
					title: "Public Title",
					content: "Public content",
					internalNotes: "Secret notes",
				},
				ctx,
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			const after = events[0].payload?.after as Record<string, unknown>;
			// The routing projection retains raw scalar fields. ACL filtering is
			// still applied to the refreshed snapshot, not to the internal outbox row.
			expect(after.title).toBe("Public Title");
			expect(after.content).toBe("Public content");
			expect(after.internalNotes).toBeDefined();

			unsub?.();
		});

		it("rejects a denied global before opening an SSE stream", async () => {
			const adapter = new MockRealtimeAdapter();
			const config = global("config")
				.fields(({ f }) => ({
					apiKey: f.textarea().required(),
					publicName: f.textarea().required(),
				}))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
					update: ({ session }) => (session?.user as any)?.role === "admin",
				});

			const testModule = {
				globals: {
					config,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const request = createRealtimeRequest([globalTopic("config")]);

			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({ accessMode: "user", role: "user" }),
				},
			);

			expect(response.ok).toBe(false);
			expect(setup.app.realtime.listeners.size).toBe(0);
		});
	});

	// ==========================================================================
	// Admission control
	// ==========================================================================

	describe("admission control", () => {
		it("enforces topic, query, and initial-concurrency caps for a mixed batch", async () => {
			const adapter = new MockRealtimeAdapter();
			let activeReads = 0;
			let maximumActiveReads = 0;
			const observedLimits: number[] = [];
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.hooks({
					beforeRead: async ({ data }) => {
						observedLimits.push(data.limit);
						activeReads += 1;
						maximumActiveReads = Math.max(maximumActiveReads, activeReads);
						await new Promise((resolve) => setTimeout(resolve, 20));
						activeReads -= 1;
					},
				})
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const topics = Array.from({ length: 21 }, (_, index) => ({
				...collectionTopic("items", { where: { name: `item-${index}` } }),
				id: `items-${index}`,
			}));
			topics[1].limit = 101;
			topics[2].with = {
				author: {
					with: { team: { with: { company: { with: { owner: true } } } } },
				},
			};

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest(topics),
				{},
				undefined,
			);
			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);
			const events: SSEEvent[] = [];
			for (let index = 0; index < 21; index += 1) {
				events.push(await reader.readEvent(5000));
			}

			expect(events.filter((event) => event.event === "snapshot")).toHaveLength(
				18,
			);
			expect(
				events
					.filter((event) => event.event === "error")
					.map((event) => event.data.topicId),
			).toEqual(expect.arrayContaining(["items-1", "items-2", "items-20"]));
			expect(observedLimits).toHaveLength(18);
			expect(observedLimits.every((limit) => limit === 100)).toBe(true);
			expect(maximumActiveReads).toBe(4);
			expect(setup.app.realtime.listeners.size).toBe(18);

			await reader.close();
			expect(setup.app.realtime.listeners.size).toBe(0);
		});

		it("preserves the access where constraint alongside the requested filter", async () => {
			const adapter = new MockRealtimeAdapter();
			const documents = collection("documents")
				.fields(({ f }) => ({
					ownerId: f.textarea().required(),
					status: f.textarea().required(),
					title: f.textarea().required(),
				}))
				.access({
					read: ({ input, session }) =>
						input?.where?.status === "published"
							? { ownerId: session?.user.id }
							: false,
					create: true,
				});
			setup = await buildMockApp(
				{ collections: { documents } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const system = createTestContext();
			await setup.app.collections.documents.create(
				{ ownerId: "alice", status: "published", title: "allowed" },
				system,
			);
			await setup.app.collections.documents.create(
				{ ownerId: "alice", status: "draft", title: "wrong status" },
				system,
			);
			await setup.app.collections.documents.create(
				{ ownerId: "bob", status: "published", title: "wrong owner" },
				system,
			);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([
					collectionTopic("documents", { where: { status: "published" } }),
				]),
				{},
				{
					appContext: createTestContext({
						accessMode: "user",
						session: createMockSession({ id: "alice" }) as any,
					}),
				},
			);
			const reader = createSSEReader(response.body!);
			const snapshot = await reader.readSnapshot();

			expect(snapshot.data.data.docs).toEqual([
				expect.objectContaining({ title: "allowed" }),
			]);
			await reader.close();
		});

		it("removes an oversized snapshot and releases its principal slot", async () => {
			const adapter = new MockRealtimeAdapter();
			const largeItems = collection("largeItems")
				.fields(({ f }) => ({ content: f.textarea().required() }))
				.access({ read: true, create: true });
			const smallItems = collection("smallItems")
				.fields(({ f }) => ({ content: f.textarea().required() }))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { largeItems, smallItems } },
				{
					realtime: {
						adapter,
						admission: { maxBufferedSnapshotBytes: 512 },
					},
				},
			);
			await runTestDbMigrations(setup.app);
			await setup.app.collections.largeItems.create(
				{ content: "x".repeat(2000) },
				createTestContext(),
			);

			const session = createMockSession({ id: "same-user" });
			const appContext = createTestContext({
				accessMode: "user",
				session: session as any,
			});
			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const oversized = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("largeItems")]),
				{},
				{ appContext },
			);
			const oversizedReader = createSSEReader(oversized.body!);
			const error = await oversizedReader.readEvent();
			expect(error.event).toBe("error");
			expect(error.data.message).toContain("Snapshot exceeds 512 bytes");
			await new Promise((resolve) => setTimeout(resolve, 20));
			expect(setup.app.realtime.listeners.size).toBe(0);
			expect(sharedSseKeepAliveTicker.size).toBe(0);

			const replacements = await Promise.all(
				Array.from({ length: 5 }, () =>
					routes.realtime.subscribe(
						createRealtimeRequest([collectionTopic("smallItems")]),
						{},
						{ appContext },
					),
				),
			);
			expect(replacements.every((response) => response.ok)).toBe(true);
			const replacementReaders = replacements.map((response) =>
				createSSEReader(response.body!),
			);
			await Promise.all(
				replacementReaders.map((reader) => reader.readSnapshot()),
			);
			await Promise.all([
				oversizedReader.close(),
				...replacementReaders.map((reader) => reader.close()),
			]);
		});
	});

	// ==========================================================================
	// Shared refresh scheduler
	// ==========================================================================

	describe("shared refresh scheduler", () => {
		it("adds and removes one topic through control frames without reconnecting", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items")]),
				{},
				undefined,
			);
			const reader = createSSEReader(response.body!);
			const session = await reader.readEvent(2000, true);
			expect(session.event).toBe("session");
			await reader.readSnapshot(2000, "col-items");

			const control = (frames: unknown[]) =>
				routes.realtime.subscribe(
					new Request("http://localhost/realtime", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							sessionId: session.data.sessionId,
							token: session.data.token,
							frames,
						}),
					}),
					{},
					undefined,
				);
			const added = await control([
				{
					type: "add_topic",
					topicId: "items-added",
					topic: {
						resourceType: "collection",
						resource: "items",
						where: { name: "added" },
					},
				},
			]);
			expect(added.status).toBe(204);
			expect((await reader.readSnapshot(2000, "items-added")).event).toBe(
				"snapshot",
			);
			expect(setup.app.realtime.listeners.size).toBe(2);

			const removed = await control([
				{ type: "remove_topic", topicId: "items-added" },
			]);
			expect(removed.status).toBe(204);
			expect(setup.app.realtime.listeners.size).toBe(1);
			await reader.close();
		});

		it("resumes an unchanged topic without another initial snapshot", async () => {
			const adapter = new MockRealtimeAdapter();
			let reads = 0;
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.hooks({ beforeRead: () => void (reads += 1) })
				.access({ read: true, create: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const context = createTestContext();
			await setup.app.collections.items.create({ name: "before" }, context);
			const sinceSeq = await setup.app.realtime.getLatestSeq();

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items", { sinceSeq })]),
				{},
				undefined,
			);
			const reader = createSSEReader(response.body!);
			await new Promise((resolve) => setTimeout(resolve, 30));
			expect(reads).toBe(0);

			await setup.app.collections.items.create({ name: "after" }, context);
			const snapshot = await reader.readSnapshot();
			expect(snapshot.data.seq).toBeGreaterThan(sinceSeq);
			expect(snapshot.data.reset).toBe(false);
			expect(reads).toBe(1);
			await reader.close();
		});

		it("forces a reset when sinceSeq is older than the retained horizon", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true, create: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const context = createTestContext();
			for (const name of ["one", "two", "three"]) {
				await setup.app.collections.items.create({ name }, context);
			}
			const latestSeq = await setup.app.realtime.getLatestSeq();
			await setup.app.db
				.delete(questpieRealtimeLogTable)
				.where(lt(questpieRealtimeLogTable.seq, latestSeq));

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items", { sinceSeq: 0 })]),
				{},
				undefined,
			);
			const reader = createSSEReader(response.body!);
			const snapshot = await reader.readSnapshot();
			expect(snapshot.data.seq).toBe(latestSeq);
			expect(snapshot.data.reset).toBe(true);
			await reader.close();
		});

		it("runs one pipeline for the five admitted same-principal connections", async () => {
			const adapter = new MockRealtimeAdapter();
			let pipelineRuns = 0;
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.hooks({ beforeRead: () => void (pipelineRuns += 1) })
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const session = createMockSession({ id: "same-user" });
			const appContext = createTestContext({
				session: session as any,
				accessMode: "user",
			});
			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const responses = await Promise.all(
				Array.from({ length: 5 }, () =>
					routes.realtime.subscribe(
						createRealtimeRequest([collectionTopic("items")]),
						{},
						{
							appContext,
						},
					),
				),
			);
			const readers = responses.map((response) =>
				createSSEReader(response.body!),
			);
			await Promise.all(readers.map((reader) => reader.readSnapshot()));
			const rejected = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items")]),
				{},
				{ appContext },
			);

			expect(rejected.ok).toBe(false);
			expect(pipelineRuns).toBe(1);
			expect(setup.app.realtime.listeners.size).toBe(1);

			await readers[0].close();
			const replacement = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items")]),
				{},
				{ appContext },
			);
			expect(replacement.ok).toBe(true);
			const replacementReader = createSSEReader(replacement.body!);
			await replacementReader.readSnapshot();
			expect(pipelineRuns).toBe(1);

			await Promise.all([
				...readers.slice(1).map((reader) => reader.close()),
				replacementReader.close(),
			]);
			expect(setup.app.realtime.listeners.size).toBe(0);
		});

		it("separates different sessions unless the entity explicitly shares", async () => {
			const adapter = new MockRealtimeAdapter();
			let privateRuns = 0;
			let publicRuns = 0;
			const privateItems = collection("privateItems")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.hooks({ beforeRead: () => void (privateRuns += 1) })
				.access({ read: true });
			const publicItems = collection("publicItems")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.options({ realtime: { accessCacheKey: () => "public-read" } })
				.hooks({ beforeRead: () => void (publicRuns += 1) })
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { privateItems, publicItems } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const contexts = ["alice", "bob"].map((id) => ({
				appContext: createTestContext({
					session: createMockSession({ id }) as any,
					accessMode: "user",
				}),
			}));
			const open = async (resource: string, context: any) => {
				const response = await routes.realtime.subscribe(
					createRealtimeRequest([collectionTopic(resource)]),
					{},
					context,
				);
				const reader = createSSEReader(response.body!);
				await reader.readSnapshot();
				return reader;
			};

			const privateReaders = await Promise.all(
				contexts.map((context) => open("privateItems", context)),
			);
			const publicReaders = await Promise.all(
				contexts.map((context) => open("publicItems", context)),
			);

			expect(privateRuns).toBe(2);
			expect(publicRuns).toBe(1);
			await Promise.all(
				[...privateReaders, ...publicReaders].map((reader) => reader.close()),
			);
		});

		it("isolates row, field, and afterRead output between principals", async () => {
			const adapter = new MockRealtimeAdapter();
			const documents = collection("documents")
				.fields(({ f }) => ({
					ownerId: f.textarea().required(),
					title: f.textarea().required(),
					secret: f.textarea().required(),
				}))
				.hooks({
					afterRead: ({ data, session }) => {
						data.title = `${data.title}:${session?.user.id}`;
					},
				})
				.access({
					read: ({ session }) => ({ ownerId: session?.user.id }),
					create: true,
					fields: {
						secret: {
							read: ({ user }) => user?.id === "bob",
						},
					},
				});
			setup = await buildMockApp(
				{ collections: { documents } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);
			const system = createTestContext();
			await setup.app.collections.documents.create(
				{ ownerId: "alice", title: "Alice", secret: "alice-secret" },
				system,
			);
			await setup.app.collections.documents.create(
				{ ownerId: "bob", title: "Bob", secret: "bob-secret" },
				system,
			);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const readFor = async (id: string, role: string) => {
				const response = await routes.realtime.subscribe(
					createRealtimeRequest([collectionTopic("documents")]),
					{},
					{
						appContext: createTestContext({
							session: createMockSession({ id, role }) as any,
							accessMode: "user",
						}),
					},
				);
				const reader = createSSEReader(response.body!);
				return { reader, snapshot: await reader.readSnapshot() };
			};

			const [alice, bob] = await Promise.all([
				readFor("alice", "user"),
				readFor("bob", "admin"),
			]);
			expect(alice.snapshot.data.data.docs).toEqual([
				expect.objectContaining({ ownerId: "alice", title: "Alice:alice" }),
			]);
			expect(alice.snapshot.data.data.docs[0]).not.toHaveProperty("secret");
			expect(bob.snapshot.data.data.docs).toEqual([
				expect.objectContaining({
					ownerId: "bob",
					title: "Bob:bob",
					secret: "bob-secret",
				}),
			]);
			await Promise.all([alice.reader.close(), bob.reader.close()]);
		});
	});

	// ==========================================================================
	// Keepalive
	// ==========================================================================

	describe("keepalive", () => {
		it("honors realtime.keepAliveIntervalMs with SSE comment pings", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({
					name: f.textarea().required(),
				}))
				.access({ read: true });

			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter, keepAliveIntervalMs: 50 } },
			);
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();
			const request = createRealtimeRequest(
				[collectionTopic("items")],
				controller.signal,
			);
			const response = await routes.realtime.subscribe(request, {}, undefined);
			expect(response.ok).toBe(true);

			const reader = createSSEReader(response.body!);
			const initial = await reader.readSnapshot();
			expect(initial.event).toBe("snapshot");

			// With a 50ms keepalive, two pings must arrive well within the
			// 2s default timeout (default cadence of 8s would time out here).
			const firstPing = await reader.readEvent();
			expect(firstPing.comment).toMatch(/^ping \d+$/);
			expect(firstPing.data).toBeNull();

			const secondPing = await reader.readEvent();
			expect(secondPing.comment).toMatch(/^ping \d+$/);

			controller.abort();
			reader.close();
		});
	});

	// ==========================================================================
	// E2E SSE Tests
	// ==========================================================================

	describe("E2E SSE streaming", () => {
		it("tears down the connection when controller.enqueue fails", async () => {
			const adapter = new LifecycleTrackingRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true });
			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const enqueueSpy = spyOn(
				ReadableStreamDefaultController.prototype,
				"enqueue",
			).mockImplementation(() => {
				throw new Error("connection is gone");
			});
			let response: Response | undefined;
			try {
				const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
				response = await routes.realtime.subscribe(
					createRealtimeRequest([collectionTopic("items")]),
					{},
					undefined,
				);
				await new Promise((resolve) => setTimeout(resolve, 20));

				expect(setup.app.realtime.listeners.size).toBe(0);
				expect(sharedSseKeepAliveTicker.size).toBe(0);
				expect(adapter.stopCalls).toBe(0);
			} finally {
				enqueueSpy.mockRestore();
				await response?.body?.cancel();
			}
		});

		it("sends an error event and closes when the transport cannot start", async () => {
			const adapter = new FailingStartRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true });

			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items")]),
				{},
				undefined,
			);
			const reader = createSSEReader(response.body!);

			let transportError: SSEEvent | undefined;
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const event = await reader.readEvent();
				if (event.event === "error") {
					transportError = event;
					break;
				}
			}

			expect(transportError?.data).toMatchObject({
				topicId: "*",
				message: "adapter start failed",
			});
			expect(
				setup.app.mocks.logger.getLogsContaining("Transport startup failed"),
			).toHaveLength(1);
			await expect(reader.readEvent()).rejects.toThrow(
				"SSE stream closed before event",
			);
		});

		it("sends an error event and closes when an outbox drain fails", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({ name: f.textarea().required() }))
				.access({ read: true });

			setup = await buildMockApp(
				{ collections: { items } },
				{ realtime: { adapter } },
			);
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const response = await routes.realtime.subscribe(
				createRealtimeRequest([collectionTopic("items")]),
				{},
				undefined,
			);
			const reader = createSSEReader(response.body!);
			expect((await reader.readSnapshot()).event).toBe("snapshot");
			await new Promise((resolve) => setTimeout(resolve, 20));

			const readSpy = spyOn(setup.app.realtime, "readSince").mockRejectedValue(
				new Error("drain failed"),
			);
			try {
				await adapter.notify({
					seq: 999,
					resourceType: "collection",
					resource: "items",
					operation: "create",
					createdAt: new Date(),
				});

				const transportError = await reader.readEvent();
				expect(transportError).toMatchObject({
					event: "error",
					data: { topicId: "*", message: "drain failed" },
				});
				await expect(reader.readEvent()).rejects.toThrow(
					"SSE stream closed before event",
				);
			} finally {
				readSpy.mockRestore();
			}
		});

		it("coalesces rapid updates into a latest snapshot", async () => {
			const adapter = new MockRealtimeAdapter();
			const counters = collection("counters")
				.fields(({ f }) => ({
					name: f.textarea().required(),
					value: f.number().required().default(0),
				}))
				.access({ read: true, create: true, update: true, delete: true });

			const testModule = {
				collections: {
					counters,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();

			const request = createRealtimeRequest(
				[collectionTopic("counters")],
				controller.signal,
			);

			const response = await routes.realtime.subscribe(request, {}, undefined);

			expect(response.ok).toBe(true);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);

			const reader = createSSEReader(response.body!);

			// Read initial snapshot
			const initial = await reader.readSnapshot();
			expect(initial.event).toBe("snapshot");
			expect(initial.data.data.docs).toEqual([]);

			const ctx = createTestContext();

			// Create multiple records rapidly
			await setup.app.collections.counters.create({ name: "A", value: 1 }, ctx);
			await setup.app.collections.counters.create({ name: "B", value: 2 }, ctx);
			await setup.app.collections.counters.create({ name: "C", value: 3 }, ctx);

			const snapshot = await reader.readSnapshot();
			expect(snapshot.event).toBe("snapshot");
			expect(snapshot.data.data.docs.length).toBeGreaterThanOrEqual(1);

			controller.abort();
			reader.close();
		});

		it("should handle client disconnection gracefully", async () => {
			const adapter = new MockRealtimeAdapter();
			const items = collection("items")
				.fields(({ f }) => ({
					name: f.textarea().required(),
				}))
				.access({ read: true });

			const testModule = {
				collections: {
					items,
				},
			};

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();

			const request = createRealtimeRequest(
				[collectionTopic("items")],
				controller.signal,
			);

			const response = await routes.realtime.subscribe(request, {}, undefined);

			expect(response.ok).toBe(true);

			// Abort immediately to simulate client disconnect
			controller.abort();

			// Should not throw or hang
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Cleanup should work without errors
			expect(true).toBe(true);
		});
	});
});
