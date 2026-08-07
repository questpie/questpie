/**
 * POST /transaction — an ordered list of mutations across several collections,
 * applied as ONE server-side transaction.
 *
 * The engine (`withTransaction` + the ambient-transaction outbox append) was
 * already atomic across collections; these tests pin the HTTP surface built on
 * top of it: all-or-nothing including the realtime outbox, per-operation
 * authorization as the requesting principal, and a failure that says which
 * operation failed.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createClient, QuestpieClientError } from "../../src/client/index.js";
import {
	collection,
	questpieRealtimeLogTable,
} from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

const comments = collection("comments").fields(({ f }) => ({
	body: f.text().required(),
}));

const tags = collection("tags").fields(({ f }) => ({
	label: f.text().required(),
}));

/** Only an admin may create one of these — the per-operation access probe. */
const auditEntries = collection("audit_entries")
	.fields(({ f }) => ({ note: f.text().required() }))
	.access({
		create: ({ session }) => (session?.user as any)?.role === "admin",
	});

const versionedDocs = collection("versioned_docs")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ optimisticConcurrency: true });

type TransactionOp = Record<string, unknown>;

describe("cross-collection transaction route", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		setup = await buildMockApp(
			{
				collections: { posts, comments, tags, auditEntries, versionedDocs },
			},
			{ realtime: { pollIntervalMs: 10 } },
		);
		await runTestDbMigrations(setup.app);
		ctx = createTestContext(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	const transact = (
		operations: TransactionOp[],
		session: ReturnType<typeof createMockSession> | null = createMockSession({
			role: "admin",
		}),
	) => {
		const handler = createFetchHandler(setup.app, {
			getSession: async () => session,
		});
		return handler(
			new Request("http://localhost/transaction", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ operations }),
			}),
		);
	};

	const counts = async () => ({
		posts: await setup.app.collections.posts.count({}, ctx),
		comments: await setup.app.collections.comments.count({}, ctx),
		tags: await setup.app.collections.tags.count({}, ctx),
		auditEntries: await setup.app.collections.auditEntries.count({}, ctx),
	});

	const outbox = () =>
		setup.app.db.select().from(questpieRealtimeLogTable) as Promise<
			Array<{ resource: string; operation: string; txid: string | null }>
		>;

	it("commits three collections atomically, under one transaction id", async () => {
		const response = await transact([
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{ collection: "comments", operation: "create", data: { body: "Body" } },
			{ collection: "tags", operation: "create", data: { label: "Label" } },
		]);

		expect(response?.status).toBe(200);
		const results = (await response?.json()) as Array<Record<string, unknown>>;
		expect(results).toHaveLength(3);
		expect(results[0]?.title).toBe("Post");
		expect(results[1]?.body).toBe("Body");
		expect(results[2]?.label).toBe("Label");

		expect(await counts()).toMatchObject({ posts: 1, comments: 1, tags: 1 });

		// One transaction means one txid — on the response and on every change
		// event the batch produced.
		const headerTxid = response?.headers.get("X-Questpie-Txid");
		expect(headerTxid).toBeString();

		const rows = await outbox();
		expect(rows).toHaveLength(3);
		expect(rows.map((row) => row.resource).sort()).toEqual([
			"comments",
			"posts",
			"tags",
		]);
		expect(new Set(rows.map((row) => row.txid)).size).toBe(1);
		expect(rows[0]?.txid).toBe(headerTxid);
	});

	it("rolls the first two operations back — and the outbox with them — when the third fails", async () => {
		const response = await transact([
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{ collection: "comments", operation: "create", data: { body: "Body" } },
			// `label` is required; this operation cannot be applied.
			{ collection: "tags", operation: "create", data: {} },
		]);

		expect(response?.status).toBeGreaterThanOrEqual(400);
		const body = (await response?.json()) as { error: Record<string, any> };
		expect(body.error.context.custom.transaction).toEqual({
			index: 2,
			collection: "tags",
			operation: "create",
			applied: false,
		});

		expect(await counts()).toMatchObject({ posts: 0, comments: 0, tags: 0 });
		expect(await outbox()).toHaveLength(0);
	});

	it("authorizes every operation as the requesting principal, not as the system", async () => {
		const restricted = [
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{
				collection: "auditEntries",
				operation: "create",
				data: { note: "Sensitive" },
			},
		];

		const denied = await transact(
			restricted,
			createMockSession({ role: "editor" }),
		);

		expect(denied?.status).toBe(403);
		const body = (await denied?.json()) as { error: Record<string, any> };
		expect(body.error.code).toBe("FORBIDDEN");
		// The batch says WHICH operation was refused; the allowed one before it
		// was still rolled back.
		expect(body.error.context.custom.transaction).toMatchObject({
			index: 1,
			collection: "auditEntries",
			applied: false,
		});
		expect(await counts()).toMatchObject({ posts: 0, auditEntries: 0 });

		// Positive control: the identical batch as an admin commits, so the
		// refusal above came from the access rule and nothing else.
		const allowed = await transact(
			restricted,
			createMockSession({ role: "admin" }),
		);
		expect(allowed?.status).toBe(200);
		expect(await counts()).toMatchObject({ posts: 1, auditEntries: 1 });
	});

	it("aborts the whole batch on a revision conflict", async () => {
		const doc = await setup.app.collections.versionedDocs.create(
			{ title: "Original" },
			ctx,
		);
		expect(doc.revision).toBe(1);

		const response = await transact([
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{
				collection: "versionedDocs",
				operation: "update",
				id: doc.id,
				expectedRevision: 99,
				data: { title: "Stale write" },
			},
		]);

		expect(response?.status).toBe(409);
		const body = (await response?.json()) as { error: Record<string, any> };
		expect(body.error.code).toBe("CONFLICT");
		expect(body.error.context.custom.transaction).toMatchObject({
			index: 1,
			collection: "versionedDocs",
			operation: "update",
			applied: false,
		});

		expect(await counts()).toMatchObject({ posts: 0 });
		const unchanged = await setup.app.collections.versionedDocs.findOne(
			{ where: { id: doc.id } },
			ctx,
		);
		expect(unchanged?.title).toBe("Original");
		expect(unchanged?.revision).toBe(1);

		// Positive control: the correct revision commits both operations.
		const fresh = await transact([
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{
				collection: "versionedDocs",
				operation: "update",
				id: doc.id,
				expectedRevision: 1,
				data: { title: "Fresh write" },
			},
		]);
		expect(fresh?.status).toBe(200);
		expect(await counts()).toMatchObject({ posts: 1 });
	});

	it("applies operations in the order given, so later ones see earlier ones", async () => {
		const created = await setup.app.collections.posts.create(
			{ title: "First" },
			ctx,
		);

		const response = await transact([
			{
				collection: "posts",
				operation: "update",
				id: created.id,
				data: { title: "Renamed" },
			},
			{ collection: "posts", operation: "delete", id: created.id },
		]);

		expect(response?.status).toBe(200);
		const results = (await response?.json()) as Array<Record<string, any>>;
		expect(results[0]?.title).toBe("Renamed");
		// The delete is served the row the update in the same transaction wrote.
		expect(results[1]?.success).toBe(true);
		expect(results[1]?.data?.title).toBe("Renamed");
		expect(await counts()).toMatchObject({ posts: 0 });
	});

	it("is reachable through the typed client, error contract included", async () => {
		const handler = createFetchHandler(setup.app, {
			getSession: async () => createMockSession({ role: "admin" }),
		});
		const client = createClient<any>({
			baseURL: "http://localhost",
			fetch: ((input: any, init: any) =>
				handler(new Request(input, init))) as typeof fetch,
		});

		const [post, comment] = await client.transaction([
			{ collection: "posts", operation: "create", data: { title: "Post" } },
			{ collection: "comments", operation: "create", data: { body: "Body" } },
		]);
		expect(post.title).toBe("Post");
		expect(comment.body).toBe("Body");
		expect(await counts()).toMatchObject({ posts: 1, comments: 1 });

		const failure = await client
			.transaction([
				{ collection: "posts", operation: "create", data: { title: "Second" } },
				{ collection: "tags", operation: "create", data: {} },
			])
			.then(
				() => null,
				(error: unknown) => error,
			);

		expect(failure).toBeInstanceOf(QuestpieClientError);
		expect((failure as QuestpieClientError).context?.custom).toMatchObject({
			transaction: { index: 1, collection: "tags", applied: false },
		});
		// The successful batch above is still there; the failed one added nothing.
		expect(await counts()).toMatchObject({ posts: 1, tags: 0 });
	});

	it("refuses a verb or a collection it does not own", async () => {
		const unknownVerb = await transact([
			{ collection: "posts", operation: "updateMany", where: {}, data: {} },
		]);
		expect(unknownVerb?.status).toBe(400);

		const unknownCollection = await transact([
			{ collection: "ghosts", operation: "create", data: {} },
		]);
		expect(unknownCollection?.status).toBe(404);

		// A prototype key is not a collection.
		const prototypeKey = await transact([
			{ collection: "constructor", operation: "create", data: {} },
		]);
		expect(prototypeKey?.status).toBe(404);

		expect(await outbox()).toHaveLength(0);
	});
});
