import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-module" }).fields(defaultFields);

const users = q
	.collection("users")
	.fields((f) => ({
		email: f.text({ required: true, maxLength: 255 }),
		name: f.textarea({ required: true }),
		ssn: f.text({ maxLength: 20 }), // Restricted field - defined in .access()
		salary: f.textarea(), // Restricted field - defined in .access()
		bio: f.textarea(), // Unrestricted field
	}))
	.title(({ f }) => f.name)
	.options({
		timestamps: true,
	})
	.access({
		// Collection-level field access - source of truth
		fields: {
			ssn: {
				read: (ctx) => (ctx.user as any)?.role === "admin",
				create: (ctx) => (ctx.user as any)?.role === "admin",
				update: (ctx) => (ctx.user as any)?.role === "admin",
			},
			salary: {
				read: (ctx) => (ctx.user as any)?.role === "admin",
				create: (ctx) => (ctx.user as any)?.role === "admin",
				update: (ctx) => (ctx.user as any)?.role === "admin",
			},
		},
	});

const publicPosts = q
	.collection("public_posts")
	.fields((f) => ({
		title: f.textarea({ required: true }),
		content: f.textarea({ required: true }),
		draft: f.textarea(), // No access rules
	}))
	.title(({ f }) => f.title)
	.options({
		timestamps: true,
	});

const testModule = q.collections({
	users,
	public_posts: publicPosts,
});

describe("field-level access control", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		await runTestDbMigrations(setup.cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("read access", () => {
		it("system mode: all fields accessible", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "test@example.com",
					name: "Test User",
					ssn: "123-45-6789",
					salary: "100000",
					bio: "Test bio",
				},
				systemCtx,
			);

			const retrieved = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				systemCtx,
			);

			expect(retrieved).toBeTruthy();
			expect(retrieved?.email).toBe("test@example.com");
			expect(retrieved?.ssn).toBe("123-45-6789");
			expect(retrieved?.salary).toBe("100000");
			expect(retrieved?.bio).toBe("Test bio");
		});

		it("user mode with no field access: all fields accessible", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.public_posts.create(
				{
					id: crypto.randomUUID(),
					title: "Public Post",
					content: "Content",
					draft: "Draft content",
				},
				systemCtx,
			);

			const retrieved = await setup.cms.api.collections.public_posts.findOne(
				{ where: { id: created.id } },
				userCtx,
			);

			expect(retrieved).toBeTruthy();
			expect(retrieved?.title).toBe("Public Post");
			expect(retrieved?.draft).toBe("Draft content");
		});

		it("user mode with read restrictions: fields stripped when role doesn't match", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "test@example.com",
					name: "Test User",
					ssn: "123-45-6789",
					salary: "100000",
					bio: "Test bio",
				},
				systemCtx,
			);

			const retrieved = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				userCtx,
			);

			expect(retrieved).toBeTruthy();
			expect(retrieved?.email).toBe("test@example.com");
			expect(retrieved?.bio).toBe("Test bio");
			// Restricted fields should be stripped
			expect(retrieved?.ssn).toBeUndefined();
			expect(retrieved?.salary).toBeUndefined();
		});

		it("function read access (role check): field accessible when role matches", async () => {
			const adminCtx = createTestContext({
				accessMode: "user",
				role: "admin",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "admin@example.com",
					name: "Admin User",
					ssn: "987-65-4321",
					salary: "200000",
					bio: "Admin bio",
				},
				systemCtx,
			);

			const retrieved = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				adminCtx,
			);

			expect(retrieved).toBeTruthy();
			expect(retrieved?.email).toBe("admin@example.com");
			expect(retrieved?.ssn).toBe("987-65-4321");
			expect(retrieved?.salary).toBe("200000");
			expect(retrieved?.bio).toBe("Admin bio");
		});

		it("function read access: field stripped unless function returns true", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const adminCtx = createTestContext({
				accessMode: "user",
				role: "admin",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "test@example.com",
					name: "Test User",
					ssn: "111-22-3333",
					salary: "150000",
					bio: "Test bio",
				},
				systemCtx,
			);

			// User context - salary should be stripped
			const userRetrieved = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				userCtx,
			);

			expect(userRetrieved?.salary).toBeUndefined();

			// Admin context - salary should be accessible
			const adminRetrieved = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				adminCtx,
			);

			expect(adminRetrieved?.salary).toBe("150000");
		});

		it("arrays of records: all filtered correctly", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "user1@example.com",
					name: "User 1",
					ssn: "111-11-1111",
					salary: "100000",
				},
				systemCtx,
			);

			await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "user2@example.com",
					name: "User 2",
					ssn: "222-22-2222",
					salary: "120000",
				},
				systemCtx,
			);

			const { docs } = await setup.cms.api.collections.users.find({}, userCtx);

			expect(docs).toHaveLength(2);
			for (const doc of docs) {
				expect(doc.email).toBeTruthy();
				expect(doc.name).toBeTruthy();
				expect(doc.ssn).toBeUndefined();
				expect(doc.salary).toBeUndefined();
			}
		});
	});

	describe("write access", () => {
		it("write access validation on create: throws if restricted field present", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			await expect(
				setup.cms.api.collections.users.create(
					{
						id: crypto.randomUUID(),
						email: "test@example.com",
						name: "Test User",
						ssn: "123-45-6789", // Restricted field
					},
					userCtx,
				),
			).rejects.toThrow("Cannot write field 'ssn': access denied");
		});

		it("write access validation on update: throws if restricted field present", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "test@example.com",
					name: "Test User",
					ssn: "123-45-6789",
				},
				systemCtx,
			);

			await expect(
				setup.cms.api.collections.users.updateById(
					{
						id: created.id,
						data: {
							ssn: "999-99-9999", // Try to update restricted field
						},
					},
					userCtx,
				),
			).rejects.toThrow("Cannot write field 'ssn': access denied");
		});

		it("write access with no restrictions: allows all fields", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const created = await setup.cms.api.collections.public_posts.create(
				{
					id: crypto.randomUUID(),
					title: "Post Title",
					content: "Post Content",
					draft: "Draft content",
				},
				userCtx,
			);

			expect(created.title).toBe("Post Title");
			expect(created.draft).toBe("Draft content");
		});

		it("write access for admin: allows restricted fields", async () => {
			const adminCtx = createTestContext({
				accessMode: "user",
				role: "admin",
			});

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "admin@example.com",
					name: "Admin User",
					ssn: "999-88-7777",
					salary: "250000",
				},
				adminCtx,
			);

			expect(created.ssn).toBe("999-88-7777");
			expect(created.salary).toBe("250000");
		});

		it("partial updates: can update allowed fields while restricted fields exist on record", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			const created = await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "test@example.com",
					name: "Test User",
					ssn: "123-45-6789",
					salary: "100000",
				},
				systemCtx,
			);

			// User can update non-restricted fields
			const updated = await setup.cms.api.collections.users.updateById(
				{
					id: created.id,
					data: {
						bio: "Updated bio",
					},
				},
				userCtx,
			);

			// Check that update succeeded
			expect(updated).toBeTruthy();

			// Verify with system context that restricted fields weren't changed
			const verified = await setup.cms.api.collections.users.findOne(
				{ where: { id: created.id } },
				systemCtx,
			);

			expect(verified?.bio).toBe("Updated bio");
			expect(verified?.ssn).toBe("123-45-6789");
			expect(verified?.salary).toBe("100000");
		});

		it("updateMany: validates field access for each record", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const systemCtx = createTestContext({ accessMode: "system" });

			await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "user1@example.com",
					name: "User 1",
					ssn: "111-11-1111",
				},
				systemCtx,
			);

			await setup.cms.api.collections.users.create(
				{
					id: crypto.randomUUID(),
					email: "user2@example.com",
					name: "User 2",
					ssn: "222-22-2222",
				},
				systemCtx,
			);

			await expect(
				setup.cms.api.collections.users.update(
					{
						where: {},
						data: {
							ssn: "999-99-9999", // Try to update restricted field
						},
					},
					userCtx,
				),
			).rejects.toThrow("Cannot write field 'ssn': access denied");
		});
	});
});
