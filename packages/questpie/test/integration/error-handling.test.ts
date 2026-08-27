import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { ApiError } from "../../src/server/errors/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const errorTest = collection("error_test")
	.fields(({ f }) => ({
		title: f.textarea().required(),
		status: f.text(50).required(),
	}))
	.title(({ f }) => f.title)
	.access({
		// Create allowed for everyone
		create: true,
		// Read requires authentication
		read: ({ session }) => !!session,
		// Update requires specific role
		update: ({ session }) => (session?.user as any)?.role === "admin",
		// Field-level access - status field restricted to admin
		fields: {
			status: {
				create: (ctx) => (ctx.user as any)?.role === "admin",
				update: (ctx) => (ctx.user as any)?.role === "admin",
			},
		},
	})
	.options({
		timestamps: true,
	});

let deniedCreateHooks = 0;
const deniedCreateTest = collection("denied_create_test")
	.fields(({ f }) => ({ title: f.text(100).required() }))
	.access({ create: false })
	.hooks({ beforeOperation: () => void (deniedCreateHooks += 1) });

const scopedCreateTest = collection("scoped_create_test")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.access({ create: () => ({ tenantId: "allowed" }) });

const operatorCreateTest = collection("operator_create_test")
	.fields(({ f }) => ({
		tenantId: f.text().required(),
		title: f.text().required(),
	}))
	.access({ create: () => ({ NOT: { tenantId: { eq: "foreign" } } }) });

describe("error handling", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		deniedCreateHooks = 0;
		setup = await buildMockApp({
			collections: {
				error_test: errorTest,
				denied_create_test: deniedCreateTest,
				scoped_create_test: scopedCreateTest,
				operator_create_test: operatorCreateTest,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("CRUD layer - error throwing", () => {
		it("should return null for missing record", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			const result = await setup.app.collections.error_test.findOne(
				{ where: { id: "00000000-0000-0000-0000-000000000000" } },
				systemCtx,
			);

			expect(result).toBeNull();
		});

		it("should throw ApiError.forbidden for unauthorized field write on create", async () => {
			const userCtx = createTestContext({
				accessMode: "user",
				user: undefined,
			});

			await expect(
				setup.app.collections.error_test.create(
					{
						id: crypto.randomUUID(),
						title: "Test Record",
						status: "draft",
					},
					userCtx,
				),
			).rejects.toThrow("Cannot write field 'status': access denied");
		});

		it("should throw ApiError.forbidden for unauthorized update", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const record = await setup.app.collections.error_test.create(
				{
					id: crypto.randomUUID(),
					title: "Test Record",
					status: "draft",
				},
				systemCtx,
			);

			const update = (id: string) =>
				setup.app.collections.error_test.updateById(
					{ id, data: { title: "Updated Title" } },
					userCtx,
				);
			const known = await update(record.id).catch((error: ApiError) => error);
			const absent = await update(crypto.randomUUID()).catch(
				(error: ApiError) => error,
			);

			expect(known).toBeInstanceOf(ApiError);
			expect(absent).toBeInstanceOf(ApiError);
			expect(known.toJSON(false)).toEqual(absent.toJSON(false));
			expect(known.context?.access?.reason).toBe("Access denied");
		});

		it("uses the neutral access reason for denied creates", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			await expect(
				setup.app.collections.denied_create_test.create(
					{ id: crypto.randomUUID(), title: "Secret target" },
					userCtx,
				),
			).rejects.toThrow("Access denied");
			expect(deniedCreateHooks).toBe(0);
		});

		it("enforces create access predicates against the proposed row", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			await expect(
				setup.app.collections.scoped_create_test.create(
					{ tenantId: "foreign", title: "Probe" },
					userCtx,
				),
			).rejects.toThrow("Access denied");
			const allowed = await setup.app.collections.scoped_create_test.create(
				{ tenantId: "allowed", title: "Accepted" },
				userCtx,
			);
			expect(allowed.title).toBe("Accepted");
		});

		it("fails closed for create predicates unsupported by the in-memory matcher", async () => {
			const userCtx = createTestContext({ accessMode: "user", role: "user" });

			await expect(
				setup.app.collections.operator_create_test.create(
					{ tenantId: "foreign", title: "Probe" },
					userCtx,
				),
			).rejects.toThrow("Access denied");
		});

		it("should throw ApiError with field-level access violation", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });
			const userCtx = createTestContext({
				accessMode: "user",
				role: "user",
			});

			const record = await setup.app.collections.error_test.create(
				{
					id: crypto.randomUUID(),
					title: "Test Record",
					status: "draft",
				},
				systemCtx,
			);

			await expect(
				setup.app.collections.error_test.updateById(
					{
						id: record.id,
						data: { status: "published" },
					},
					userCtx,
				),
			).rejects.toThrow("Access denied");
		});

		it("should throw ApiError for database constraint violation", async () => {
			const systemCtx = createTestContext({ accessMode: "system" });

			try {
				// Try to create without required field
				await setup.app.collections.error_test.create(
					{
						id: crypto.randomUUID(),
						title: null as any, // intentionally null to trigger constraint violation
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
		it("should transform ApiError to proper HTTP response shape", () => {
			const error = ApiError.notFound("Record", "123");
			const json = error.toJSON(false);

			// Verify shape matches ApiErrorShape
			expect(json.code).toBe("NOT_FOUND");
			expect(json.message).toContain("Record not found: 123");
			expect(json.stack).toBeUndefined(); // Not in production mode
		});

		it("should include stack trace in dev mode", () => {
			const error = ApiError.internal("Something went wrong");
			const json = error.toJSON(true);

			expect(json.stack).toBeDefined();
			expect(typeof json.stack).toBe("string");
		});

		it("should properly serialize field errors", () => {
			// Mock Zod v4 error structure (uses 'issues' not 'errors')
			const error = ApiError.fromZodError(
				{
					issues: [
						{ path: ["title"], message: "Too short", input: "ab" },
						{ path: ["status"], message: "Invalid value", input: "invalid" },
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
			const error = ApiError.forbidden({
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
		it("ApiError.notFound should create proper error", () => {
			const error = ApiError.notFound("User", "123");
			expect(error.code).toBe("NOT_FOUND");
			expect(error.message).toContain("User not found: 123");
			expect(error.getHTTPStatus()).toBe(404);
		});

		it("ApiError.forbidden should create proper error", () => {
			const error = ApiError.forbidden({
				operation: "delete",
				resource: "posts",
				reason: "Cannot delete published posts",
			});
			expect(error.code).toBe("FORBIDDEN");
			expect(error.getHTTPStatus()).toBe(403);
		});

		it("ApiError.badRequest should create proper error", () => {
			const error = ApiError.badRequest("Invalid input");
			expect(error.code).toBe("BAD_REQUEST");
			expect(error.getHTTPStatus()).toBe(400);
		});

		it("ApiError.unauthorized should create proper error", () => {
			const error = ApiError.unauthorized();
			expect(error.code).toBe("UNAUTHORIZED");
			expect(error.getHTTPStatus()).toBe(401);
		});

		it("ApiError.notImplemented should create proper error", () => {
			const error = ApiError.notImplemented("Soft delete");
			expect(error.code).toBe("NOT_IMPLEMENTED");
			expect(error.getHTTPStatus()).toBe(501);
		});

		it("ApiError.conflict should create proper error", () => {
			const error = ApiError.conflict("Record already exists");
			expect(error.code).toBe("CONFLICT");
			expect(error.getHTTPStatus()).toBe(409);
		});

		it("ApiError.internal should create proper error", () => {
			const error = ApiError.internal("Database connection failed");
			expect(error.code).toBe("INTERNAL_SERVER_ERROR");
			expect(error.getHTTPStatus()).toBe(500);
		});
	});
});
