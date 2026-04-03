import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

describe("collection IDs (field builder)", () => {
	describe("default id", () => {
		const posts = collection("posts").fields(({ f }) => ({
			title: f.text(255).required(),
		}));

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({ collections: { posts } });
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("generates a uuid-like string id when omitted", async () => {
			const created = await setup.app.collections.posts.create(
				{ title: "Test Post" },
				createTestContext(),
			);

			expect(typeof created.id).toBe("string");
			expect(created.id).toMatch(
				/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
			);
		});

		it("allows providing a custom string id", async () => {
			const id = crypto.randomUUID();
			const created = await setup.app.collections.posts.create(
				{ id, title: "Test Post" },
				createTestContext(),
			);

			expect(created.id).toBe(id);
		});
	});

	describe("i18n with default id", () => {
		const posts = collection("posts")
			.fields(({ f }) => ({
				sku: f.text(50).required(),
				title: f.text(255).required().localized(),
			}))
			.title(({ f }) => f.title);

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({ collections: { posts } });
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("stores translations per locale and falls back", async () => {
			const ctx = createTestContext();

			const created = await setup.app.collections.posts.create(
				{ sku: "SKU-001", title: "English Title" },
				ctx,
			);

			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { title: "Slovensky Nazov" } },
				createTestContext({ locale: "sk" }),
			);

			const en = await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				createTestContext({ locale: "en" }),
			);
			const sk = await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				createTestContext({ locale: "sk" }),
			);
			const de = await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				createTestContext({ locale: "de" }),
			);

			expect(en?.title).toBe("English Title");
			expect(sk?.title).toBe("Slovensky Nazov");
			expect(de?.title).toBe("English Title");
		});
	});

	describe("versioning with default id", () => {
		const posts = collection("posts")
			.fields(({ f }) => ({
				title: f.text(255).required(),
			}))
			.options({ versioning: true });

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({ collections: { posts } });
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("records versions with string id", async () => {
			const ctx = createTestContext();

			const created = await setup.app.collections.posts.create(
				{ title: "Original" },
				ctx,
			);

			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { title: "Updated" } },
				ctx,
			);

			const versions = await setup.app.collections.posts.findVersions(
				{ id: created.id },
				ctx,
			);

			expect(versions.length).toBe(2);
			expect(versions[0].id).toBe(created.id);
			expect(typeof versions[0].id).toBe("string");
		});
	});

	describe("combined i18n + versioning with default id", () => {
		const posts = collection("posts")
			.fields(({ f }) => ({
				sku: f.text(50).required(),
				title: f.text(255).required().localized(),
			}))
			.options({ versioning: true });

		let setup: Awaited<ReturnType<typeof buildMockApp>>;

		beforeEach(async () => {
			setup = await buildMockApp({ collections: { posts } });
			await runTestDbMigrations(setup.app);
		});

		afterEach(async () => {
			await setup.cleanup();
		});

		it("supports localized updates and versions together", async () => {
			const ctx = createTestContext();

			const created = await setup.app.collections.posts.create(
				{ sku: "SKU-001", title: "English Title" },
				ctx,
			);

			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { title: "Slovensky Nazov" } },
				createTestContext({ locale: "sk" }),
			);

			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { sku: "SKU-002" } },
				ctx,
			);

			const en = await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				createTestContext({ locale: "en" }),
			);
			const sk = await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				createTestContext({ locale: "sk" }),
			);

			expect(en?.title).toBe("English Title");
			expect(sk?.title).toBe("Slovensky Nazov");

			const versions = await setup.app.collections.posts.findVersions(
				{ id: created.id },
				ctx,
			);

			expect(versions.length).toBeGreaterThanOrEqual(3);
			expect(typeof versions[0].id).toBe("string");
		});
	});
});
