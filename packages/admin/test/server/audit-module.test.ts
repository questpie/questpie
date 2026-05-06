import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "questpie";

import { buildMockApp } from "../../../questpie/test/utils/mocks/mock-app-builder";
import { createTestContext } from "../../../questpie/test/utils/test-context";
import { runTestDbMigrations } from "../../../questpie/test/utils/test-db";
import {
	AUDIT_LOG_COLLECTION,
	auditModule,
	logAuditEntry,
} from "../../src/server/modules/audit/index.js";

const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

const settings = global("settings")
	.fields(({ f }) => ({
		siteName: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

const skipped = collection("skipped")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.set("admin", { audit: false });

describe("audit module e2e", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { posts, skipped },
			globals: { settings },
			modules: [auditModule],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("registers the audit collection under its runtime slug", () => {
		expect(setup.app.collections[AUDIT_LOG_COLLECTION]).toBeDefined();
		expect((setup.app.collections as any).auditLogCollection).toBeUndefined();
	});

	it("records collection create, update, transition, and delete entries", async () => {
		const ctx = createTestContext({
			accessMode: "system",
			session: {
				user: { id: "user_1", name: "Admin User" },
				session: { id: "session_1" },
			} as any,
		});

		const post = await setup.app.collections.posts.create(
			{ id: crypto.randomUUID(), title: "Draft Post" },
			ctx,
		);
		await setup.app.collections.posts.updateById(
			{ id: post.id, data: { title: "Draft Post Updated" } },
			ctx,
		);
		await setup.app.collections.posts.transitionStage(
			{ id: post.id, stage: "published" },
			ctx,
		);
		await setup.app.collections.posts.deleteById({ id: post.id }, ctx);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: { resource: "posts", resourceId: post.id },
				sort: { createdAt: "asc" },
			},
			ctx,
		);

		expect(logs.docs.map((entry: any) => entry.action)).toEqual([
			"create",
			"update",
			"transition",
			"delete",
		]);
		expect(logs.docs[0].userId).toBe("user_1");
		expect(logs.docs[0].changes).toEqual({
			title: { from: null, to: "Draft Post" },
		});
		expect(logs.docs[0].metadata).toMatchObject({
			actorType: "user",
			accessMode: "system",
			operation: "create",
		});
		expect(logs.docs[1].changes).toEqual({
			title: { from: "Draft Post", to: "Draft Post Updated" },
		});
		expect(logs.docs[1].metadata).toMatchObject({
			actorType: "user",
			accessMode: "system",
			operation: "update",
		});
		expect(logs.docs[2].changes).toEqual({
			stage: { from: "draft", to: "published" },
		});
		expect(logs.docs[2].metadata).toMatchObject({
			actorType: "user",
			accessMode: "system",
			fromStage: "draft",
			toStage: "published",
		});
		expect(logs.docs[3].changes).toEqual({
			title: { from: "Draft Post Updated", to: null },
		});
		expect(logs.docs[3].metadata).toMatchObject({
			actorType: "user",
			accessMode: "system",
			operation: "delete",
		});
	});

	it("labels system collection operations without a session as System", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const post = await setup.app.collections.posts.create(
			{ id: crypto.randomUUID(), title: "System Draft" },
			ctx,
		);
		await setup.app.collections.posts.transitionStage(
			{ id: post.id, stage: "published" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: { resource: "posts", resourceId: post.id },
				sort: { createdAt: "asc" },
			},
			ctx,
		);

		expect(logs.docs.map((entry: any) => entry.userId)).toEqual([
			"system",
			"system",
		]);
		expect(logs.docs.map((entry: any) => entry.userName)).toEqual([
			"System",
			"System",
		]);
		expect(logs.docs[0].title.startsWith("System created")).toBe(true);
		expect(logs.docs[1].title.startsWith("System changed status")).toBe(true);
		expect(logs.docs[0].metadata).toMatchObject({
			actorType: "system",
			accessMode: "system",
		});
	});

	it("labels sessionless user-mode operations as Anonymous", async () => {
		const ctx = createTestContext({
			accessMode: "user",
			session: null,
		});

		const post = await setup.app.collections.posts.create(
			{ id: crypto.randomUUID(), title: "Anonymous Draft" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{ where: { resource: "posts", resourceId: post.id } },
			createTestContext({ accessMode: "system" }),
		);

		expect(logs.docs[0].userId).toBeNull();
		expect(logs.docs[0].userName).toBe("Anonymous");
		expect(logs.docs[0].title.startsWith("Anonymous created")).toBe(true);
		expect(logs.docs[0].metadata).toMatchObject({
			actorType: "anonymous",
			accessMode: "user",
		});
	});

	it("records global update and transition entries", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.globals.settings.update({ siteName: "Draft Site" }, ctx);
		await setup.app.globals.settings.transitionStage(
			{ stage: "published" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: { resourceType: "global", resource: "settings" },
				sort: { createdAt: "asc" },
			},
			ctx,
		);

		expect(logs.docs.map((entry: any) => entry.action)).toEqual([
			"update",
			"transition",
		]);
		expect(logs.docs.map((entry: any) => entry.userId)).toEqual([
			"system",
			"system",
		]);
		expect(logs.docs.map((entry: any) => entry.userName)).toEqual([
			"System",
			"System",
		]);
		expect(logs.docs[1].changes).toEqual({
			stage: { from: "draft", to: "published" },
		});
		expect(logs.docs[0].metadata).toMatchObject({
			actorType: "system",
			accessMode: "system",
			operation: "update",
		});
		expect(logs.docs[1].metadata).toMatchObject({
			actorType: "system",
			accessMode: "system",
			fromStage: "draft",
			toStage: "published",
		});
	});

	it("skips resources with admin.audit set to false", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await setup.app.collections.skipped.create(
			{ id: crypto.randomUUID(), title: "Hidden" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{ where: { resource: "skipped" } },
			ctx,
		);

		expect(logs.docs).toHaveLength(0);
	});

	describe("logAuditEntry — public API", () => {
		it("writes a custom audit entry with explicit actor", async () => {
			const ctx = createTestContext({
				accessMode: "system",
				session: {
					user: { id: "job_runner", name: "Job Runner" },
					session: { id: "s1" },
				} as any,
			});

			await logAuditEntry(
				{ collections: setup.app.collections, ...ctx },
				{
					action: "bulk-email",
					resourceType: "system",
					resource: "newsletter",
					resourceLabel: "Q1 Campaign",
					metadata: { sentCount: 1234 },
				},
			);

			const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "newsletter" } },
				ctx,
			);

			expect(logs.docs).toHaveLength(1);
			const entry = logs.docs[0];
			expect(entry.action).toBe("bulk-email");
			expect(entry.resourceType).toBe("system");
			expect(entry.resource).toBe("newsletter");
			expect(entry.resourceLabel).toBe("Q1 Campaign");
			expect(entry.userName).toBe("Job Runner");
			expect(entry.userId).toBe("job_runner");
			expect(entry.metadata).toMatchObject({
				actorType: "user",
				sentCount: 1234,
			});
			expect(entry.title).toContain("Job Runner");
			expect(entry.title).toContain("bulk-email");
			expect(entry.title).toContain("Q1 Campaign");
		});

		it("resolves actor from session when not overridden", async () => {
			const ctx = createTestContext({
				accessMode: "system",
				session: {
					user: { id: "u1", name: "Alice" },
					session: { id: "s1" },
				} as any,
			});

			await logAuditEntry(
				{ collections: setup.app.collections, ...ctx },
				{
					action: "archive",
					resourceType: "collection",
					resource: "posts",
					resourceId: "post_123",
					resourceLabel: "My Post",
				},
			);

			const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "posts", action: "archive" } },
				ctx,
			);

			expect(logs.docs[0].userName).toBe("Alice");
			expect(logs.docs[0].userId).toBe("u1");
		});

		it("falls back to System when no session is present", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await logAuditEntry(
				{ collections: setup.app.collections, ...ctx },
				{
					action: "cleanup",
					resourceType: "system",
					resource: "temp-files",
				},
			);

			const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "temp-files" } },
				ctx,
			);

			expect(logs.docs[0].userName).toBe("System");
			expect(logs.docs[0].userId).toBe("system");
			expect(logs.docs[0].metadata).toMatchObject({
				actorType: "system",
			});
		});

		it("allows overriding userName and userId", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await logAuditEntry(
				{ collections: setup.app.collections, ...ctx },
				{
					action: "webhook-received",
					resourceType: "system",
					resource: "stripe",
					userName: "Stripe Webhook",
					userId: "webhook_stripe",
					actorType: "system",
					metadata: { eventId: "evt_123" },
				},
			);

			const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "stripe" } },
				ctx,
			);

			expect(logs.docs[0].userName).toBe("Stripe Webhook");
			expect(logs.docs[0].userId).toBe("webhook_stripe");
			expect(logs.docs[0].metadata).toMatchObject({
				actorType: "system",
				eventId: "evt_123",
			});
			expect(logs.docs[0].title).toContain("Stripe Webhook");
		});

		it("stores changes and locale", async () => {
			const ctx = createTestContext({ accessMode: "system" });

			await logAuditEntry(
				{ collections: setup.app.collections, ...ctx },
				{
					action: "migrate",
					resourceType: "system",
					resource: "database",
					resourceLabel: "v2 to v3",
					locale: "en",
					changes: { schema: { from: "v2", to: "v3" } },
				},
			);

			const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "database" } },
				ctx,
			);

			expect(logs.docs[0].locale).toBe("en");
			expect(logs.docs[0].changes).toEqual({
				schema: { from: "v2", to: "v3" },
			});
		});
	});
});
