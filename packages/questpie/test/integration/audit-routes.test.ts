import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

/**
 * Tests for audit route handlers on collections and globals.
 *
 * The audit routes query an "adminAuditLog" collection to return audit entries.
 * Here we set up a mock adminAuditLog collection so the routes have data to return.
 */

const createModule = () => {
	const q = questpie({ name: "audit-routes-test" }).fields(defaultFields);

	const posts = q.collection("posts").fields((f) => ({
		title: f.text({ required: true }),
	}));

	const settings = q.global("settings").fields((f) => ({
		siteName: f.text({ required: true }),
	}));

	// Mock audit log collection matching the schema the audit route expects
	const adminAuditLog = q.collection("adminAuditLog").fields((f) => ({
		action: f.text({ required: true }),
		resourceType: f.text({ required: true }),
		resource: f.text({ required: true }),
		resourceId: f.text(),
		resourceLabel: f.text(),
		userId: f.text(),
		userName: f.text(),
		locale: f.text(),
		changes: f.json(),
		metadata: f.json(),
		title: f.text(),
	}));

	return q
		.collections({ posts, adminAuditLog })
		.globals({ settings })
		.defaultAccess({ read: true, create: true, update: true, delete: true });
};

describe("audit routes", () => {
	let setup: Awaited<
		ReturnType<typeof buildMockApp<ReturnType<typeof createModule>>>
	>;

	beforeEach(async () => {
		setup = await buildMockApp(createModule());
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("collection audit endpoint", () => {
		it("returns audit entries for a specific record", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			// Create a post
			const post = await setup.app.api.collections.posts.create(
				{ title: "Audited Post" },
				ctx,
			);

			// Insert mock audit log entries
			await setup.app.api.collections.adminAuditLog.create(
				{
					action: "create",
					resourceType: "collection",
					resource: "posts",
					resourceId: post.id,
					resourceLabel: "Audited Post",
					title: "Created posts 'Audited Post'",
				},
				ctx,
			);
			await setup.app.api.collections.adminAuditLog.create(
				{
					action: "update",
					resourceType: "collection",
					resource: "posts",
					resourceId: post.id,
					resourceLabel: "Audited Post",
					title: "Updated posts 'Audited Post'",
					changes: { title: { from: "Audited Post", to: "Updated Post" } },
				},
				ctx,
			);

			// Query audit route
			const response = await handler(
				new Request(`http://localhost/posts/${post.id}/audit`),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;

			// Route returns the find result which includes docs
			const docs = body.docs ?? body;
			expect(Array.isArray(docs)).toBe(true);
			expect(docs.length).toBe(2);

			// Both audit entries should be present
			const actions = docs.map((d: any) => d.action).sort();
			expect(actions).toEqual(["create", "update"]);
		});

		it("returns empty array when no audit entries exist", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			const post = await setup.app.api.collections.posts.create(
				{ title: "No Audit" },
				ctx,
			);

			const response = await handler(
				new Request(`http://localhost/posts/${post.id}/audit`),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;
			const docs = body.docs ?? body;
			expect(Array.isArray(docs)).toBe(true);
			expect(docs.length).toBe(0);
		});

		it("supports limit and offset pagination", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			const post = await setup.app.api.collections.posts.create(
				{ title: "Paginated" },
				ctx,
			);

			// Insert 3 audit entries
			for (let i = 1; i <= 3; i++) {
				await setup.app.api.collections.adminAuditLog.create(
					{
						action: "update",
						resourceType: "collection",
						resource: "posts",
						resourceId: post.id,
						title: `Update ${i}`,
					},
					ctx,
				);
			}

			// Query with limit=2
			const response = await handler(
				new Request(`http://localhost/posts/${post.id}/audit?limit=2`),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;
			const docs = body.docs ?? body;
			expect(docs.length).toBe(2);
		});

		it("returns 404 for nonexistent collection", async () => {
			const handler = createFetchHandler(setup.app);

			const response = await handler(
				new Request("http://localhost/nonexistent/fake-id/audit"),
			);

			expect(response?.status).toBe(404);
		});

		it("only returns entries for the requested record", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			const post1 = await setup.app.api.collections.posts.create(
				{ title: "Post 1" },
				ctx,
			);
			const post2 = await setup.app.api.collections.posts.create(
				{ title: "Post 2" },
				ctx,
			);

			// Create audit entries for both posts
			await setup.app.api.collections.adminAuditLog.create(
				{
					action: "create",
					resourceType: "collection",
					resource: "posts",
					resourceId: post1.id,
					title: "Created Post 1",
				},
				ctx,
			);
			await setup.app.api.collections.adminAuditLog.create(
				{
					action: "create",
					resourceType: "collection",
					resource: "posts",
					resourceId: post2.id,
					title: "Created Post 2",
				},
				ctx,
			);

			// Query audit for post1 only
			const response = await handler(
				new Request(`http://localhost/posts/${post1.id}/audit`),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;
			const docs = body.docs ?? body;
			expect(docs.length).toBe(1);
			expect(docs[0].resourceId).toBe(post1.id);
		});
	});

	describe("global audit endpoint", () => {
		it("returns audit entries for a global", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			// Initialize global
			await setup.app.api.globals.settings.update({ siteName: "My Site" }, ctx);

			// Insert mock audit log entries for the global
			await setup.app.api.collections.adminAuditLog.create(
				{
					action: "update",
					resourceType: "global",
					resource: "settings",
					resourceLabel: "settings",
					title: "Updated settings",
				},
				ctx,
			);

			const response = await handler(
				new Request("http://localhost/globals/settings/audit"),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;
			const docs = body.docs ?? body;
			expect(Array.isArray(docs)).toBe(true);
			expect(docs.length).toBe(1);
			expect(docs[0].action).toBe("update");
			expect(docs[0].resourceType).toBe("global");
		});

		it("returns empty array when no audit log collection exists", async () => {
			// Set up an app without adminAuditLog collection
			const q = questpie({ name: "no-audit-test" }).fields(defaultFields);
			const settings = q.global("settings").fields((f) => ({
				siteName: f.text({ required: true }),
			}));
			const noAuditModule = q.globals({ settings }).defaultAccess({
				read: true,
				create: true,
				update: true,
				delete: true,
			});

			const noAuditSetup = await buildMockApp(noAuditModule);
			await runTestDbMigrations(noAuditSetup.app);

			try {
				const handler = createFetchHandler(noAuditSetup.app);

				const response = await handler(
					new Request("http://localhost/globals/settings/audit"),
				);

				expect(response?.status).toBe(200);
				const body = (await response?.json()) as any;
				// When no adminAuditLog collection exists, route returns []
				expect(Array.isArray(body)).toBe(true);
				expect(body.length).toBe(0);
			} finally {
				await noAuditSetup.cleanup();
			}
		});

		it("supports pagination on global audit", async () => {
			const handler = createFetchHandler(setup.app);
			const ctx = createTestContext();

			// Insert 3 audit entries
			for (let i = 1; i <= 3; i++) {
				await setup.app.api.collections.adminAuditLog.create(
					{
						action: "update",
						resourceType: "global",
						resource: "settings",
						title: `Update ${i}`,
					},
					ctx,
				);
			}

			const response = await handler(
				new Request("http://localhost/globals/settings/audit?limit=1&offset=0"),
			);

			expect(response?.status).toBe(200);
			const body = (await response?.json()) as any;
			const docs = body.docs ?? body;
			expect(docs.length).toBe(1);
		});
	});
});
