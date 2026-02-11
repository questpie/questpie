import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createTestContext } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const q = questpie({ name: "test-module" }).fields(defaultFields);

// Collection WITHOUT explicit access - should inherit defaultAccess
const publicPosts = q.collection("public_posts").fields((f) => ({
	title: f.textarea({ required: true }),
}));

// Collection WITH explicit access - should override defaultAccess
const adminNotes = q
	.collection("admin_notes")
	.fields((f) => ({
		content: f.textarea({ required: true }),
	}))
	.access({
		read: ({ session }) => (session?.user as any)?.role === "admin",
		create: ({ session }) => (session?.user as any)?.role === "admin",
	});

// Collection with PARTIAL access - only read defined, others should fallback to defaultAccess
const partialAccessPosts = q
	.collection("partial_access_posts")
	.fields((f) => ({
		title: f.textarea({ required: true }),
	}))
	.access({
		// Only read is defined - create/update/delete should use defaultAccess
		read: () => true, // Public read
	});

// Global WITHOUT explicit access - should inherit defaultAccess
const siteSettings = q.global("site_settings").fields((f) => ({
	siteName: f.textarea({ required: true }),
}));

// Global WITH explicit access - should override defaultAccess
const adminSettings = q
	.global("admin_settings")
	.fields((f) => ({
		secretKey: f.textarea({ required: true }),
	}))
	.access({
		read: ({ session }) => (session?.user as any)?.role === "admin",
		update: ({ session }) => (session?.user as any)?.role === "admin",
	});

describe("default access control", () => {
	// Create CMS with defaultAccess requiring authentication
	const testModule = q
		.collections({
			public_posts: publicPosts,
			admin_notes: adminNotes,
			partial_access_posts: partialAccessPosts,
		})
		.globals({
			site_settings: siteSettings,
			admin_settings: adminSettings,
		});

	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule, {
			defaultAccess: {
				read: ({ session }) => !!session,
				create: ({ session }) => !!session,
				update: ({ session }) => !!session,
				delete: ({ session }) => !!session,
			},
		});
		await runTestDbMigrations(setup.cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("collections without explicit access", () => {
		it("should deny access when no session (defaultAccess applied)", async () => {
			const noSessionCtx = createTestContext({ session: null });

			await expect(
				setup.cms.api.collections.public_posts.create(
					{ title: "Test Post" },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should allow access when session exists (defaultAccess applied)", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			const result = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				userCtx,
			);

			expect(result).toBeDefined();
			expect(result.title).toBe("Test Post");
		});
	});

	describe("collections with explicit access", () => {
		it("should use collection access instead of defaultAccess", async () => {
			// Regular user should be denied (admin_notes requires admin role)
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			await expect(
				setup.cms.api.collections.admin_notes.create(
					{ content: "Secret note" },
					userCtx,
				),
			).rejects.toThrow();
		});

		it("should allow access when collection access rules are satisfied", async () => {
			// Admin should be allowed (admin_notes explicit access allows admins)
			const adminCtx = createTestContext({ accessMode: "user", role: "admin" });

			const result = await setup.cms.api.collections.admin_notes.create(
				{ content: "Secret note" },
				adminCtx,
			);

			expect(result).toBeDefined();
			expect(result.content).toBe("Secret note");
		});
	});

	describe("system access mode", () => {
		it("should bypass defaultAccess in system mode", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			const result = await setup.cms.api.collections.public_posts.create(
				{ title: "System Post" },
				systemCtx,
			);

			expect(result).toBeDefined();
			expect(result.title).toBe("System Post");
		});
	});

	describe("all CRUD operations", () => {
		it("should deny read when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Create a post first with system access
			const post = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				systemCtx,
			);

			// Try to read without session
			await expect(
				setup.cms.api.collections.public_posts.findOne(
					{ where: { id: post.id } },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should deny update when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Create a post first with system access
			const post = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				systemCtx,
			);

			// Try to update without session
			await expect(
				setup.cms.api.collections.public_posts.updateById(
					{ id: post.id, data: { title: "Updated" } },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should deny delete when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Create a post first with system access
			const post = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				systemCtx,
			);

			// Try to delete without session
			await expect(
				setup.cms.api.collections.public_posts.deleteById(
					{ id: post.id },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should deny delete when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Create a post first with system access
			const post = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				systemCtx,
			);

			// Try to delete without session
			await expect(
				setup.cms.api.collections.public_posts.deleteById(
					{ id: post.id },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should allow all CRUD operations with valid session", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			// Create
			const post = await setup.cms.api.collections.public_posts.create(
				{ title: "Test Post" },
				userCtx,
			);
			expect(post.title).toBe("Test Post");

			// Read
			const found = await setup.cms.api.collections.public_posts.findOne(
				{ where: { id: post.id } },
				userCtx,
			);
			expect(found?.title).toBe("Test Post");

			// Update
			const updated = await setup.cms.api.collections.public_posts.updateById(
				{ id: post.id, data: { title: "Updated" } },
				userCtx,
			);
			expect(updated.title).toBe("Updated");

			// Delete
			await setup.cms.api.collections.public_posts.deleteById(
				{ id: post.id },
				userCtx,
			);

			// Verify deleted
			const deleted = await setup.cms.api.collections.public_posts.findOne(
				{ where: { id: post.id } },
				userCtx,
			);
			expect(deleted).toBeNull();
		});
	});

	describe("partial access override", () => {
		it("should use explicit read access (public) while defaultAccess applies to create", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Create with system access first
			const post = await setup.cms.api.collections.partial_access_posts.create(
				{ title: "Public Post" },
				systemCtx,
			);

			// Read should work without session (explicit public read access)
			const found =
				await setup.cms.api.collections.partial_access_posts.findOne(
					{ where: { id: post.id } },
					noSessionCtx,
				);
			expect(found?.title).toBe("Public Post");

			// Create should fail without session (fallback to defaultAccess)
			await expect(
				setup.cms.api.collections.partial_access_posts.create(
					{ title: "Another Post" },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should fallback to defaultAccess for update/delete when only read is defined", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			// Create with system access
			const post = await setup.cms.api.collections.partial_access_posts.create(
				{ title: "Test Post" },
				systemCtx,
			);

			// Update should fail without session (defaultAccess requires session)
			await expect(
				setup.cms.api.collections.partial_access_posts.updateById(
					{ id: post.id, data: { title: "Updated" } },
					noSessionCtx,
				),
			).rejects.toThrow();

			// Delete should fail without session (defaultAccess requires session)
			await expect(
				setup.cms.api.collections.partial_access_posts.deleteById(
					{ id: post.id },
					noSessionCtx,
				),
			).rejects.toThrow();

			// But should work with session
			const updated =
				await setup.cms.api.collections.partial_access_posts.updateById(
					{ id: post.id, data: { title: "Updated" } },
					userCtx,
				);
			expect(updated.title).toBe("Updated");
		});
	});

	describe("globals defaultAccess", () => {
		it("should deny global read when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Initialize global first with system access
			await setup.cms.api.globals.site_settings.update(
				{ siteName: "Test Site" },
				systemCtx,
			);

			// Try to read without session (note: get(options, context) signature)
			await expect(
				setup.cms.api.globals.site_settings.get({}, noSessionCtx),
			).rejects.toThrow();
		});

		it("should allow global read with valid session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			// Initialize global first with system access
			await setup.cms.api.globals.site_settings.update(
				{ siteName: "Test Site" },
				systemCtx,
			);

			const settings = await setup.cms.api.globals.site_settings.get(
				{},
				userCtx,
			);
			expect(settings).toBeDefined();
			expect(settings?.siteName).toBe("Test Site");
		});

		it("should deny global update when no session (defaultAccess applied)", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const noSessionCtx = createTestContext({ session: null });

			// Initialize global first with system access
			await setup.cms.api.globals.site_settings.update(
				{ siteName: "Test Site" },
				systemCtx,
			);

			// Try to update without session
			await expect(
				setup.cms.api.globals.site_settings.update(
					{ siteName: "New Name" },
					noSessionCtx,
				),
			).rejects.toThrow();
		});

		it("should allow global update with valid session (defaultAccess applied)", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			const settings = await setup.cms.api.globals.site_settings.update(
				{ siteName: "My Site" } as any,
				userCtx,
			);
			expect((settings as any).siteName).toBe("My Site");
		});

		it("should use global explicit access instead of defaultAccess", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({ accessMode: "user", role: "user" });
			const adminCtx = createTestContext({ accessMode: "user", role: "admin" });

			// Initialize global first with system access
			await setup.cms.api.globals.admin_settings.update(
				{ secretKey: "secret123" },
				systemCtx,
			);

			// Regular user should be denied (admin_settings requires admin role)
			await expect(
				setup.cms.api.globals.admin_settings.get({}, userCtx),
			).rejects.toThrow();

			// Admin should be allowed
			const settings = await setup.cms.api.globals.admin_settings.get(
				{},
				adminCtx,
			);
			expect(settings).toBeDefined();
			expect(settings?.secretKey).toBe("secret123");
		});
	});
});
