/**
 * Introspection Access Tests
 *
 * Schema/meta routes (`GET /:collection/{schema,meta}` and globals
 * equivalents) are gated through the normal access system:
 *
 *   access.introspect → defaultAccess.introspect →
 *   visible iff at least one CRUD operation is allowed
 *
 * Deny-all apps therefore leak nothing — the off-switch IS the access config.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { createMockSession } from "../utils/test-context.js";
import { runTestDbMigrations } from "../utils/test-db.js";

// No access rules — deny-all defaultAccess applies to every operation
const lockedPosts = collection("locked_posts").fields(({ f }) => ({
	title: f.textarea().required(),
}));

// Session users get read access — and therefore introspection
const memberPosts = collection("member_posts")
	.fields(({ f }) => ({
		title: f.textarea().required(),
	}))
	.access({
		read: ({ session }) => !!session,
	});

// Public contact-form pattern: anonymous create needs the validation schema
const publicForms = collection("public_forms")
	.fields(({ f }) => ({
		email: f.textarea().required(),
		message: f.textarea(),
	}))
	.access({
		create: true,
	});

// Shape is public even though no operation is allowed
const shapePublic = collection("shape_public")
	.fields(({ f }) => ({
		title: f.textarea(),
	}))
	.access({
		introspect: true,
	});

// Shape is hidden even from users who can read the data
const shapeHidden = collection("shape_hidden")
	.fields(({ f }) => ({
		title: f.textarea(),
	}))
	.access({
		read: true,
		introspect: false,
	});

// Globals parity
const lockedSettings = global("locked_settings").fields(({ f }) => ({
	siteName: f.textarea(),
}));

const shapeSettings = global("shape_settings")
	.fields(({ f }) => ({
		siteName: f.textarea(),
	}))
	.access({
		introspect: true,
	});

describe("introspection access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let anonHandler: ReturnType<typeof createFetchHandler>;
	let userHandler: ReturnType<typeof createFetchHandler>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				locked_posts: lockedPosts,
				member_posts: memberPosts,
				public_forms: publicForms,
				shape_public: shapePublic,
				shape_hidden: shapeHidden,
			},
			globals: {
				locked_settings: lockedSettings,
				shape_settings: shapeSettings,
			},
			// Deny-all app — jubli's posture
			defaultAccess: {
				read: false,
				create: false,
				update: false,
				delete: false,
			},
		});
		await runTestDbMigrations(setup.app);

		anonHandler = createFetchHandler(setup.app, {
			basePath: "/api",
			requestLogging: false,
			getSession: async () => null,
		});
		userHandler = createFetchHandler(setup.app, {
			basePath: "/api",
			requestLogging: false,
			getSession: async () => createMockSession({ role: "user" }),
		});
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	const get = (handler: ReturnType<typeof createFetchHandler>, path: string) =>
		handler(new Request(`http://localhost${path}`));

	describe("deny-all collections", () => {
		it("denies anonymous schema with 401", async () => {
			const response = await get(anonHandler, "/api/locked_posts/schema");
			expect(response?.status).toBe(401);
		});

		it("denies anonymous meta with 401", async () => {
			const response = await get(anonHandler, "/api/locked_posts/meta");
			expect(response?.status).toBe(401);
		});

		it("denies authenticated users with 403 (deny-all means deny-all)", async () => {
			const schema = await get(userHandler, "/api/locked_posts/schema");
			expect(schema?.status).toBe(403);

			const meta = await get(userHandler, "/api/locked_posts/meta");
			expect(meta?.status).toBe(403);
		});
	});

	describe("collections with allowed operations", () => {
		it("allows schema/meta for users with read access", async () => {
			const schema = await get(userHandler, "/api/member_posts/schema");
			expect(schema?.status).toBe(200);
			const body = (await schema!.json()) as any;
			expect(body.access.visible).toBe(true);
			expect(body.access.operations.read.allowed).toBe(true);

			const meta = await get(userHandler, "/api/member_posts/meta");
			expect(meta?.status).toBe(200);
		});

		it("denies anonymous users when no operation is allowed for them", async () => {
			const response = await get(anonHandler, "/api/member_posts/schema");
			expect(response?.status).toBe(401);
		});

		it("keeps schema readable for anonymous create-only collections", async () => {
			// Client-side validation of a public form needs the schema
			const response = await get(anonHandler, "/api/public_forms/schema");
			expect(response?.status).toBe(200);
			const body = (await response!.json()) as any;
			expect(body.access.operations.create.allowed).toBe(true);
			expect(body.fields.email).toBeDefined();
		});
	});

	describe("introspect override", () => {
		it("introspect: true exposes schema/meta without any operation access", async () => {
			const schema = await get(anonHandler, "/api/shape_public/schema");
			expect(schema?.status).toBe(200);

			const meta = await get(anonHandler, "/api/shape_public/meta");
			expect(meta?.status).toBe(200);

			// The DATA stays locked — introspect only opens the shape
			const list = await get(anonHandler, "/api/shape_public");
			expect(list?.status).toBe(403);
		});

		it("introspect: false hides schema/meta even from users with read access", async () => {
			const schema = await get(userHandler, "/api/shape_hidden/schema");
			expect(schema?.status).toBe(403);

			const meta = await get(userHandler, "/api/shape_hidden/meta");
			expect(meta?.status).toBe(403);

			// Anonymous gets 401 (no session to blame)
			const anonSchema = await get(anonHandler, "/api/shape_hidden/schema");
			expect(anonSchema?.status).toBe(401);

			// Reading the data itself still works (read: true)
			const list = await get(userHandler, "/api/shape_hidden");
			expect(list?.status).toBe(200);
		});
	});

	describe("globals parity", () => {
		it("denies anonymous global schema/meta under deny-all", async () => {
			const schema = await get(
				anonHandler,
				"/api/globals/locked_settings/schema",
			);
			expect(schema?.status).toBe(401);

			const meta = await get(anonHandler, "/api/globals/locked_settings/meta");
			expect(meta?.status).toBe(401);
		});

		it("denies authenticated global schema/meta under deny-all with 403", async () => {
			const schema = await get(
				userHandler,
				"/api/globals/locked_settings/schema",
			);
			expect(schema?.status).toBe(403);
		});

		it("introspect: true exposes global schema/meta anonymously", async () => {
			const schema = await get(
				anonHandler,
				"/api/globals/shape_settings/schema",
			);
			expect(schema?.status).toBe(200);

			const meta = await get(anonHandler, "/api/globals/shape_settings/meta");
			expect(meta?.status).toBe(200);
		});
	});
});
