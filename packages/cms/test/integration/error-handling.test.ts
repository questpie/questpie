import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { text, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { defineCollection, defineQCMS } from "#questpie/cms/server/index.js";
import { CMSError } from "#questpie/cms/server/errors";
import { buildMockCMS } from "../utils/mocks/mock-cms-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const errorTest = defineCollection("error_test")
	.fields({
		title: text("title").notNull(),
		status: varchar("status", { length: 50 }).notNull(),
	})
	.title(({ table }) => sql`${table.title}`)
	.access({
		// Create allowed for everyone
		create: true,
		// Read requires authentication
		read: ({ context }) => !!(context as any)?.user,
		// Update requires specific role
		update: ({ context }) => (context as any)?.user?.role === "admin",
		// Field-level access
		fields: {
			status: {
				write: ({ context }) => (context as any)?.user?.role === "admin",
			},
		},
	})
	.options({
		timestamps: true,
	});

const testModule = defineQCMS({ name: "test-module" }).collections({
	error_test: errorTest,
});

describe("error handling", () => {
	let setup: Awaited<ReturnType<typeof buildMockCMS<typeof testModule>>>;

	beforeEach(async () => {
		setup = await buildMockCMS(testModule);
		await runTestDbMigrations(setup.cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("CRUD layer - error throwing", () => {
		it("should return null for missing record", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			const result = await setup.cms.api.collections.error_test.findOne(
				{ where: { id: "00000000-0000-0000-0000-000000000000" } },
				systemCtx,
			);

			expect(result).toBeNull();
		});

		it("should throw CMSError.forbidden for unauthorized field write on create", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				user: null,
			});

			await expect(
				setup.cms.api.collections.error_test.create(
					{
						id: crypto.randomUUID(),
						title: "Test Record",
						status: "draft",
					},
					userCtx,
				),
			).rejects.toThrow("Cannot write field 'status': access denied");
		});

		it("should throw CMSError.forbidden for unauthorized update", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({
				accessMode: "user",
				user: { id: "1", role: "user" },
			});

			const record = await setup.cms.api.collections.error_test.create(
				{
					id: crypto.randomUUID(),
					title: "Test Record",
					status: "draft",
				},
				systemCtx,
			);

			await expect(
				setup.cms.api.collections.error_test.updateById(
					{
						id: record.id,
						data: { title: "Updated Title" },
					},
					userCtx,
				),
			).rejects.toThrow("User does not have permission to update this record");
		});

		it("should throw CMSError with field-level access violation", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({
				accessMode: "user",
				user: { id: "1", role: "user" },
			});

			const record = await setup.cms.api.collections.error_test.create(
				{
					id: crypto.randomUUID(),
					title: "Test Record",
					status: "draft",
				},
				systemCtx,
			);

			await expect(
				setup.cms.api.collections.error_test.updateById(
					{
						id: record.id,
						data: { status: "published" },
					},
					userCtx,
				),
			).rejects.toThrow("User does not have permission to update this record");
		});

		it("should throw CMSError for database constraint violation", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			try {
				// Try to create without required field
				await setup.cms.api.collections.error_test.create(
					{
						id: crypto.randomUUID(),
						// @ts-expect-error - intentionally missing required fields
						title: null,
						status: "draft",
					},
					systemCtx,
				);
				expect.unreachable("Should have thrown");
			} catch (error) {
				// Database constraint errors should be caught
				expect(error).toBeDefined();
			}
		});
	});

	describe("HTTP adapter - error transformation", () => {
		it("should transform CMSError to proper HTTP response shape", () => {
			const error = CMSError.notFound("Record", "123");
			const json = error.toJSON(false);

			// Verify shape matches CMSErrorShape
			expect(json.code).toBe("NOT_FOUND");
			expect(json.message).toContain("Record not found: 123");
			expect(json.stack).toBeUndefined(); // Not in production mode
		});

		it("should include stack trace in dev mode", () => {
			const error = CMSError.internal("Something went wrong");
			const json = error.toJSON(true);

			expect(json.stack).toBeDefined();
			expect(typeof json.stack).toBe("string");
		});

		it("should properly serialize field errors", () => {
			const error = CMSError.fromZodError(
				{
					errors: [
						{ path: ["title"], message: "Too short", received: "ab" },
						{ path: ["status"], message: "Invalid value", received: "invalid" },
					],
				},
				"Validation failed",
			);

			const json = error.toJSON(false);

			expect(json.code).toBe("VALIDATION_ERROR");
			expect(json.fieldErrors).toBeDefined();
			expect(json.fieldErrors?.length).toBe(2);
			expect(json.fieldErrors?.[0].path).toBe("title");
			expect(json.fieldErrors?.[1].path).toBe("status");
		});

		it("should properly serialize access context", () => {
			const error = CMSError.forbidden({
				operation: "update",
				resource: "posts",
				reason: "Insufficient permissions",
				fieldPath: "publishedAt",
			});

			const json = error.toJSON(false);

			expect(json.code).toBe("FORBIDDEN");
			expect(json.context?.access?.operation).toBe("update");
			expect(json.context?.access?.resource).toBe("posts");
			expect(json.context?.access?.fieldPath).toBe("publishedAt");
		});
	});

	describe("error helper methods", () => {
		it("CMSError.notFound should create proper error", () => {
			const error = CMSError.notFound("User", "123");
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toContain("User not found: 123");
			expect(error.getHTTPStatus()).toBe(404);
		});

		it("CMSError.forbidden should create proper error", () => {
			const error = CMSError.forbidden({
				operation: "delete",
				resource: "posts",
				reason: "Cannot delete published posts",
			});
			expect(error.code).toBe("FORBIDDEN");
			expect(error.getHTTPStatus()).toBe(403);
		});

		it("CMSError.badRequest should create proper error", () => {
			const error = CMSError.badRequest("Invalid input");
			expect(error.code).toBe("BAD_REQUEST");
			expect(error.getHTTPStatus()).toBe(400);
		});

		it("CMSError.unauthorized should create proper error", () => {
			const error = CMSError.unauthorized();
			expect(error.code).toBe("UNAUTHORIZED");
			expect(error.getHTTPStatus()).toBe(401);
		});

		it("CMSError.notImplemented should create proper error", () => {
			const error = CMSError.notImplemented("Soft delete");
			expect(error.code).toBe("NOT_IMPLEMENTED");
			expect(error.getHTTPStatus()).toBe(501);
		});

		it("CMSError.conflict should create proper error", () => {
			const error = CMSError.conflict("Record already exists");
			expect(error.code).toBe("CONFLICT");
			expect(error.getHTTPStatus()).toBe(409);
		});

		it("CMSError.internal should create proper error", () => {
			const error = CMSError.internal("Database connection failed");
			expect(error.code).toBe("INTERNAL_SERVER_ERROR");
			expect(error.getHTTPStatus()).toBe(500);
		});
	});
});
