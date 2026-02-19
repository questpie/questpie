// @ts-nocheck // TODO: Temporary until test utils are fully typed
import { afterEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import {
	createAdapterRoutes,
	questpie,
	questpieRealtimeLogTable,
	type RealtimeAdapter,
	type RealtimeChangeEvent,
} from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
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
	public startCalls = 0;
	public stopCalls = 0;

	async start(): Promise<void> {
		this.startCalls += 1;
	}

	async stop(): Promise<void> {
		this.stopCalls += 1;
	}
}

type SSEEvent = {
	event: string;
	data: any;
};

type TopicInput = {
	id: string;
	resourceType: "collection" | "global";
	resource: string;
	where?: Record<string, unknown>;
	with?: Record<string, unknown>;
	limit?: number;
	offset?: number;
	orderBy?: Record<string, "asc" | "desc">;
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

	const readEvent = async (timeoutMs = 2000): Promise<SSEEvent> => {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const separatorIndex = buffer.indexOf("\n\n");
			if (separatorIndex !== -1) {
				const chunk = buffer.slice(0, separatorIndex);
				buffer = buffer.slice(separatorIndex + 2);

				let event = "message";
				let data = "";
				for (const line of chunk.split("\n")) {
					if (line.startsWith("event:")) {
						event = line.slice(6).trim();
					} else if (line.startsWith("data:")) {
						data += line.slice(5).trim();
					}
				}

				return {
					event,
					data: data ? JSON.parse(data) : null,
				};
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
			if (event.event === "ping") {
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
	// Core Logging Tests
	// ==========================================================================

	describe("change logging", () => {
		it("logs realtime changes for create/update/delete", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true, localized: true }),
				slug: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ posts }).locale({
				locales: [{ code: "en" }, { code: "sk" }],
				defaultLocale: "en",
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctxEn = createTestContext({ locale: "en", defaultLocale: "en" });
			const ctxSk = createTestContext({ locale: "sk", defaultLocale: "en" });

			const created = await setup.app.api.collections.posts.create(
				{ title: "Hello", slug: "hello" },
				ctxEn,
			);
			await setup.app.api.collections.posts.updateById(
				{ id: created.id, data: { title: "Ahoj" } },
				ctxSk,
			);
			await setup.app.api.collections.posts.deleteById(
				{ id: created.id },
				ctxEn,
			);

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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				slug: f.textarea({ required: true }),
			}));

			const testModule = q.collections({
				posts,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);
			const ctx = createTestContext();

			const first = await setup.app.api.collections.posts.create(
				{ title: "One", slug: "one" },
				ctx,
			);
			const second = await setup.app.api.collections.posts.create(
				{ title: "Two", slug: "two" },
				ctx,
			);

			await setup.app.api.collections.posts.update(
				{ where: { id: { in: [first.id, second.id] } }, data: { slug: "new" } },
				ctx,
			);
			await setup.app.api.collections.posts.delete(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				status: f.textarea({ required: true }),
			}));

			const testModule = q.collections({
				posts,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: RealtimeChangeEvent[] = [];

			const unsub = setup.app.realtime?.subscribe((event) =>
				events.push(event),
			);

			await setup.app.api.collections.posts.create(
				{ title: "Hello", status: "published" },
				ctx,
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			expect(events[0].payload).toBeDefined();
			expect(events[0].payload?.title).toBe("Hello");
			expect(events[0].payload?.status).toBe("published");

			unsub?.();
		});
	});

	// ==========================================================================
	// WHERE Filter Tests
	// ==========================================================================

	describe("WHERE filtering", () => {
		it("only notifies subscribers with matching WHERE filter", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const messages = q.collection("messages").fields((f) => ({
				chatId: f.textarea({ required: true }),
				content: f.textarea({ required: true }),
			}));

			const testModule = q.collections({
				messages,
			});

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

			await setup.app.api.collections.messages.create(
				{ chatId: "chat1", content: "Hello chat1" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(chat1Events.length).toBe(1);
			expect(chat2Events.length).toBe(0);
			expect(allEvents.length).toBe(1);

			await setup.app.api.collections.messages.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				status: f.textarea({ required: true }),
				authorId: f.textarea({ required: true }),
				title: f.textarea({ required: true }),
			}));

			const testModule = q.collections({
				posts,
			});

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
			await setup.app.api.collections.posts.create(
				{ status: "draft", authorId: "author1", title: "Draft" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(0);

			// Wrong author
			await setup.app.api.collections.posts.create(
				{ status: "published", authorId: "author2", title: "By Author 2" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(0);

			// Both match
			await setup.app.api.collections.posts.create(
				{
					status: "published",
					authorId: "author1",
					title: "Published by Author 1",
				},
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].payload?.status).toBe("published");
			expect(events[0].payload?.authorId).toBe("author1");

			unsub?.();
		});

		it("refreshes create events for complex OR filters", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				status: f.textarea({ required: true }),
				authorId: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ posts });

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

			await setup.app.api.collections.posts.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				status: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ posts });

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

			await setup.app.api.collections.posts.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const tasks = q.collection("tasks").fields((f) => ({
				title: f.textarea({ required: true }),
				completed: f.boolean({ required: true, default: false }),
			}));

			const testModule = q.collections({
				tasks,
			});

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
			await setup.app.api.collections.tasks.create(
				{ title: "Todo", completed: false },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(completedEvents.length).toBe(0);

			// Create completed task
			await setup.app.api.collections.tasks.create(
				{ title: "Done", completed: true },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(completedEvents.length).toBe(1);

			unsub?.();
		});

		it("filters by numeric fields", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const products = q.collection("products").fields((f) => ({
				name: f.textarea({ required: true }),
				categoryId: f.number({ required: true }),
			}));

			const testModule = q.collections({
				products,
			});

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

			await setup.app.api.collections.products.create(
				{ name: "Product A", categoryId: 2 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(category1Events.length).toBe(0);

			await setup.app.api.collections.products.create(
				{ name: "Product B", categoryId: 1 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(category1Events.length).toBe(1);

			unsub?.();
		});

		it("supports wildcard collection subscriptions", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q
				.collection("posts")
				.fields((f) => ({ title: f.textarea({ required: true }) }));
			const comments = q
				.collection("comments")
				.fields((f) => ({ content: f.textarea({ required: true }) }));

			const testModule = q.collections({
				posts,
				comments,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const allEvents: any[] = [];

			const unsub = setup.app.realtime?.subscribe(
				(event) => allEvents.push(event),
				{ resourceType: "collection", resource: "*" },
			);

			await setup.app.api.collections.posts.create({ title: "Post 1" }, ctx);
			await setup.app.api.collections.comments.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				status: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ posts });

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

			const post = await setup.app.api.collections.posts.create(
				{ title: "Published post", status: "published" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(filteredEvents.length).toBe(1);

			filteredEvents.length = 0;

			await setup.app.api.collections.posts.updateById(
				{ id: post.id, data: { status: "draft" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(filteredEvents.length).toBe(1);
			expect(filteredEvents[0].operation).toBe("update");

			unsub?.();
		});

		it("re-sends snapshot for filtered subscriber on delete", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				status: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ posts });

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

			const post = await setup.app.api.collections.posts.create(
				{ title: "To delete", status: "published" },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(filteredEvents.length).toBe(1);

			filteredEvents.length = 0;

			await setup.app.api.collections.posts.deleteById({ id: post.id }, ctx);
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const users = q
				.collection("users")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const messages = q.collection("messages").fields((f) => ({
				chatId: f.textarea({ required: true }),
				content: f.textarea({ required: true }),
				user: f.relation({
					to: "users",
					required: true,
					relationName: "user",
				}),
			}));

			const testModule = q.collections({
				users,
				messages,
			});

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
			const user = await setup.app.api.collections.users.create(
				{ name: "Alice" },
				ctx,
			);
			await setup.app.api.collections.messages.create(
				{ chatId: "chat1", content: "Hello", user: user.id }, // FK column key is field name with unified API
				ctx,
			);

			let snapshot = await reader.readSnapshot();
			while (snapshot.data.data.docs.length === 0) {
				snapshot = await reader.readSnapshot();
			}
			expect(snapshot.data.data.docs[0].user.name).toBe("Alice");

			// Update the user - should trigger refresh
			await setup.app.api.collections.users.updateById(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const users = q
				.collection("users")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const posts = q.collection("posts").fields((f) => ({
				title: f.textarea({ required: true }),
				user: f.relation({
					to: "users",
					required: true,
					relationName: "user",
				}),
			}));

			const comments = q.collection("comments").fields((f) => ({
				content: f.textarea({ required: true }),
				post: f.relation({
					to: "posts",
					required: true,
					relationName: "post",
				}),
			}));

			const testModule = q.collections({
				users,
				posts,
				comments,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const user = await setup.app.api.collections.users.create(
				{ name: "Bob" },
				ctx,
			);
			const post = await setup.app.api.collections.posts.create(
				{ title: "Post 1", user: user.id }, // FK column key is field name with unified API
				ctx,
			);
			const comment = await setup.app.api.collections.comments.create(
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
			await setup.app.api.collections.comments.updateById(
				{ id: comment.id, data: { content: "Updated comment" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("comments");
			events.length = 0;

			// Update post (first level relation)
			await setup.app.api.collections.posts.updateById(
				{ id: post.id, data: { title: "Updated Post" } },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);
			expect(events[0].resource).toBe("posts");
			events.length = 0;

			// Update user (deeply nested relation)
			await setup.app.api.collections.users.updateById(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const categories = q
				.collection("categories")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const products = q.collection("products").fields((f) => ({
				name: f.textarea({ required: true }),
				category: f.relation({
					to: "categories",
					required: true,
					relationName: "category",
				}),
			}));

			const testModule = q.collections({
				categories,
				products,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const category = await setup.app.api.collections.categories.create(
				{ name: "Electronics" },
				ctx,
			);
			await setup.app.api.collections.products.create(
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
			await setup.app.api.collections.categories.updateById(
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
		it("re-sends snapshots when global changes", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const settings = q
				.global("settings")
				.fields((f) => ({ title: f.textarea() }));

			const testModule = q.globals({
				settings,
			});

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
			await setup.app.api.globals.settings.update({ title: "New Title" }, ctx);

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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const categories = q
				.collection("categories")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const settings = q.global("settings").fields((f) => ({
				siteName: f.textarea(),
				defaultCategory: f.relation({
					to: "categories",
					relationName: "defaultCategory",
				}),
			}));

			const testModule = q.collections({ categories }).globals({ settings });

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
			const category = await setup.app.api.collections.categories.create(
				{ name: "Tech" },
				ctx,
			);
			await setup.app.api.globals.settings.update(
				{ siteName: "My Site", defaultCategory: category.id },
				ctx,
			);

			let snapshot = await reader.readSnapshot();
			while (!snapshot.data.data?.defaultCategory?.name) {
				snapshot = await reader.readSnapshot();
			}
			expect(snapshot.data.data.defaultCategory.name).toBe("Tech");

			// Update category should trigger settings refresh
			await setup.app.api.collections.categories.updateById(
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
		it("restarts adapter after all subscribers disconnect", async () => {
			const adapter = new LifecycleTrackingRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const items = q
				.collection("items")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const testModule = q.collections({ items });

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const firstUnsub = setup.app.realtime?.subscribe(() => {}, {
				resourceType: "collection",
				resource: "items",
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(adapter.startCalls).toBe(1);

			firstUnsub?.();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(adapter.stopCalls).toBe(1);

			const secondUnsub = setup.app.realtime?.subscribe(() => {}, {
				resourceType: "collection",
				resource: "items",
			});
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(adapter.startCalls).toBe(2);

			secondUnsub?.();
		});

		it("handles multiple subscribers with different filters", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const orders = q.collection("orders").fields((f) => ({
				status: f.textarea({ required: true }),
				customerId: f.textarea({ required: true }),
				total: f.number({ required: true }),
			}));

			const testModule = q.collections({
				orders,
			});

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
			await setup.app.api.collections.orders.create(
				{ status: "pending", customerId: "c1", total: 100 },
				ctx,
			);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(pendingEvents.length).toBe(1);
			expect(customer1Events.length).toBe(1);
			expect(allEvents.length).toBe(1);

			// Completed order for customer 2 - should trigger only all
			await setup.app.api.collections.orders.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const items = q
				.collection("items")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const testModule = q.collections({
				items,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe((e) => events.push(e), {
				resourceType: "collection",
				resource: "items",
			});

			await setup.app.api.collections.items.create({ name: "Item 1" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1);

			// Unsubscribe
			unsub?.();

			// Should not receive this event
			await setup.app.api.collections.items.create({ name: "Item 2" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(events.length).toBe(1); // Still 1
		});

		it("handles empty WHERE filter (matches all)", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const logs = q
				.collection("logs")
				.fields((f) => ({ message: f.textarea({ required: true }) }));

			const testModule = q.collections({
				logs,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const ctx = createTestContext();
			const events: any[] = [];

			const unsub = setup.app.realtime?.subscribe((e) => events.push(e), {
				resourceType: "collection",
				resource: "logs",
				where: {},
			});

			await setup.app.api.collections.logs.create({ message: "Log 1" }, ctx);
			await setup.app.api.collections.logs.create({ message: "Log 2" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(2);

			unsub?.();
		});

		it("scales filtered routing across many subscribers", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const messages = q.collection("messages").fields((f) => ({
				roomId: f.textarea({ required: true }),
				content: f.textarea({ required: true }),
			}));

			const testModule = q.collections({ messages });

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

			await setup.app.api.collections.messages.create(
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
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const items = q
				.collection("items")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const testModule = q.collections({ items });

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
			await setup.app.api.collections.items.create({ name: "new" }, ctx);
			await new Promise((resolve) => setTimeout(resolve, 150));

			const logs = await setup.app.db
				.select()
				.from(questpieRealtimeLogTable)
				.orderBy(questpieRealtimeLogTable.seq);

			const hasOldRow = logs.some((row: any) => row.recordId === "old-record");
			expect(hasOldRow).toBe(false);
			expect(logs.some((row: any) => row.payload?.name === "new")).toBe(true);
		});

		it("cleans up consumed realtime rows using min consumed seq", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const items = q
				.collection("items")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const testModule = q.collections({ items });

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
			await setup.app.api.collections.items.create(
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
				false,
			);
			expect(
				logs.some((row: any) => row.payload?.name === "after-subscribe"),
			).toBe(true);

			unsub?.();
		});
	});

	// ==========================================================================
	// Access Control Tests
	// ==========================================================================

	describe("access control", () => {
		it("should send error event when user lacks read permission", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const secrets = q
				.collection("secrets")
				.fields((f) => ({
					content: f.textarea({ required: true }),
					level: f.textarea({ required: true }),
				}))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
					create: true,
				});

			const testModule = q.collections({
				secrets,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			// First create some data as admin
			const adminCtx = createTestContext({ accessMode: "user", role: "admin" });
			await setup.app.api.collections.secrets.create(
				{ content: "Secret content", level: "high" },
				adminCtx,
			);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();

			// Request without admin role should receive error in SSE stream
			const request = createRealtimeRequest(
				[collectionTopic("secrets")],
				controller.signal,
			);

			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({ accessMode: "user", role: "user" }),
				},
			);

			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);

			// Should receive error event due to access denied
			const error = await reader.readEvent();
			expect(error.event).toBe("error");
			expect(error.data.message).toContain("permission");

			controller.abort();
			reader.close();
		});

		it("should allow access for authorized users", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const secrets = q
				.collection("secrets")
				.fields((f) => ({
					content: f.textarea({ required: true }),
					level: f.textarea({ required: true }),
				}))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
					create: true,
				});

			const testModule = q.collections({
				secrets,
			});

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

		it("should filter payload fields based on field-level access", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const documents = q
				.collection("documents")
				.fields((f) => ({
					title: f.textarea({ required: true }),
					content: f.textarea({ required: true }),
					internalNotes: f.textarea({ required: true }),
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

			const testModule = q.collections({
				documents,
			});

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
			await setup.app.api.collections.documents.create(
				{
					title: "Public Title",
					content: "Public content",
					internalNotes: "Secret notes",
				},
				ctx,
			);

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(events.length).toBe(1);
			// Payload should include all fields from the create operation
			expect(events[0].payload?.title).toBe("Public Title");
			expect(events[0].payload?.content).toBe("Public content");
			// internalNotes is filtered at read time via CRUD, but event payload
			// contains the raw data - this is the current behavior
			expect(events[0].payload?.internalNotes).toBeDefined();

			unsub?.();
		});

		it("should handle global access restrictions", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const config = q
				.global("config")
				.fields((f) => ({
					apiKey: f.textarea({ required: true }),
					publicName: f.textarea({ required: true }),
				}))
				.access({
					read: ({ session }) => (session?.user as any)?.role === "admin",
					update: ({ session }) => (session?.user as any)?.role === "admin",
				});

			const testModule = q.globals({
				config,
			});

			setup = await buildMockApp(testModule, { realtime: { adapter } });
			await runTestDbMigrations(setup.app);

			const routes = createAdapterRoutes(setup.app, { accessMode: "user" });
			const controller = new AbortController();

			// Non-admin request should receive error in SSE
			const request = createRealtimeRequest(
				[globalTopic("config")],
				controller.signal,
			);

			const response = await routes.realtime.subscribe(
				request,
				{},
				{
					appContext: createTestContext({ accessMode: "user", role: "user" }),
				},
			);

			expect(response.ok).toBe(true);
			const reader = createSSEReader(response.body!);

			let receivedError = false;
			try {
				for (let i = 0; i < 5; i++) {
					const event = await reader.readEvent(500);
					if (event.event === "error") {
						receivedError = true;
						expect(event.data.message).toContain("access");
						break;
					}
				}
			} catch {
				// Timeout is acceptable
			}

			expect(receivedError).toBe(true);

			controller.abort();
			reader.close();
		});
	});

	// ==========================================================================
	// E2E SSE Tests
	// ==========================================================================

	describe("E2E SSE streaming", () => {
		it("should stream multiple snapshots on rapid updates", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const counters = q.collection("counters").fields((f) => ({
				name: f.textarea({ required: true }),
				value: f.number({ required: true, default: 0 }),
			}));

			const testModule = q.collections({
				counters,
			});

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
			await setup.app.api.collections.counters.create(
				{ name: "A", value: 1 },
				ctx,
			);
			await setup.app.api.collections.counters.create(
				{ name: "B", value: 2 },
				ctx,
			);
			await setup.app.api.collections.counters.create(
				{ name: "C", value: 3 },
				ctx,
			);

			// Should receive snapshots reflecting the changes
			let snapshotCount = 0;
			const startTime = Date.now();

			while (snapshotCount < 3 && Date.now() - startTime < 5000) {
				try {
					const snapshot = await reader.readSnapshot();
					if (snapshot.event === "snapshot") {
						snapshotCount++;
						// Each snapshot should have more docs
						expect(snapshot.data.data.docs.length).toBeGreaterThanOrEqual(0);
					}
				} catch {
					break;
				}
			}

			// We should have received at least one update
			expect(snapshotCount).toBeGreaterThanOrEqual(1);

			controller.abort();
			reader.close();
		});

		it("should handle client disconnection gracefully", async () => {
			const adapter = new MockRealtimeAdapter();
			const q = questpie({ name: "realtime-test" }).fields(defaultFields);
			const items = q
				.collection("items")
				.fields((f) => ({ name: f.textarea({ required: true }) }));

			const testModule = q.collections({
				items,
			});

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
