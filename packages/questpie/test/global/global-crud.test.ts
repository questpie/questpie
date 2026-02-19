import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultFields } from "../../src/server/fields/builtin/defaults.js";
import { questpie } from "../../src/server/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const q = questpie({ name: "test-module" }).fields(defaultFields);

const testModule = q
	.collections({
		posts: q
			.collection("posts")
			.fields((f) => ({
				title: f.textarea({ required: true }),
			}))
			.options({
				versioning: true,
			}),
	})
	.globals({
		site_config: q
			.global("site_config")
			.fields((f) => ({
				siteName: f.text({ required: true, maxLength: 100 }),
				featuredPost: f.relation({
					to: "posts",
					relationName: "featuredPost",
				}),
			}))
			.options({
				versioning: {
					enabled: true,
					maxVersions: 2,
				},
			}),
		localized_config: q.global("localized_config").fields((f) => ({
			title: f.textarea({ localized: true }),
		})),
		auto_config: q.global("auto_config").fields((f) => ({
			mode: f.text({ maxLength: 20, default: "auto" }),
		})),
		read_only_config: q
			.global("read_only_config")
			.fields((f) => ({
				mode: f.text({ maxLength: 20, default: "read" }),
			}))
			.access({
				read: true,
				update: false,
			}),
		workflow_config: q
			.global("workflow_config")
			.fields((f) => ({
				title: f.text({ required: true }),
			}))
			.options({
				versioning: true,
				workflow: {
					stages: ["draft", "published"],
					initialStage: "draft",
				},
			}),
		guarded_workflow_config: q
			.global("guarded_workflow_config")
			.fields((f) => ({
				title: f.text({ required: true }),
			}))
			.options({
				versioning: true,
				workflow: {
					stages: {
						draft: { transitions: ["review"] },
						review: { transitions: ["published"] },
						published: { transitions: [] },
					},
					initialStage: "draft",
				},
			}),
	});

describe("global CRUD", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
	let app: any; // Use any to bypass type issues with FK column names

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("supports globals API, versioning, and relations", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const post = await app.api.collections.posts.create(
			{
				id: crypto.randomUUID(),
				title: "Hello",
			},
			ctx,
		);

		await app.api.globals.site_config.update(
			{
				siteName: "One",
			},
			ctx,
		);
		await app.api.globals.site_config.update(
			{
				siteName: "Two",
			},
			ctx,
		);
		await app.api.globals.site_config.update(
			{
				siteName: "Three",
				featuredPost: post.id, // Global FK columns use field name, not {field}Id
			},
			ctx,
		);

		const versions = await app.api.globals.site_config.findVersions({}, ctx);
		expect(versions).toHaveLength(2);
		expect(versions[0].siteName).toBe("Two");

		const fetched = await app.api.globals.site_config.get(
			{ with: { featuredPost: true } },
			ctx,
		);
		expect(fetched?.featuredPost?.title).toBe("Hello");

		await app.api.globals.site_config.revertToVersion(
			{ version: versions[0].versionNumber },
			ctx,
		);

		const reverted = await app.api.globals.site_config.get({}, ctx);
		expect(reverted?.siteName).toBe("Two");
	});

	it("reverts global versions by versionId", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.api.globals.site_config.update({ siteName: "First" }, ctx);
		await app.api.globals.site_config.update({ siteName: "Second" }, ctx);

		const versions = await app.api.globals.site_config.findVersions({}, ctx);
		await app.api.globals.site_config.revertToVersion(
			{ versionId: versions[0].versionId },
			ctx,
		);

		const reverted = await app.api.globals.site_config.get({}, ctx);
		expect(reverted?.siteName).toBe("First");
	});

	it("supports localized globals with fallback", async () => {
		const ctxEn = createTestContext({
			accessMode: "system",
			locale: "en",
			defaultLocale: "en",
		});
		const ctxSk = createTestContext({
			accessMode: "system",
			locale: "sk",
			defaultLocale: "en",
		});
		const ctxFr = createTestContext({
			accessMode: "system",
			locale: "fr",
			defaultLocale: "en",
		});

		await app.api.globals.localized_config.update({ title: "Hello" }, ctxEn);
		await app.api.globals.localized_config.update({ title: "Ahoj" }, ctxSk);

		const sk = await app.api.globals.localized_config.get({}, ctxSk);
		expect(sk?.title).toBe("Ahoj");

		const fr = await app.api.globals.localized_config.get({}, ctxFr);
		expect(fr?.title).toBe("Hello");
	});

	it("auto-creates globals on get", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await app.api.globals.auto_config.get({}, ctx);
		expect(created?.mode).toBe("auto");
	});

	it("auto-creates globals without update access", async () => {
		const ctx = createTestContext({ accessMode: "user" });
		const created = await app.api.globals.read_only_config.get({}, ctx);
		expect(created?.mode).toBe("read");
	});

	it("reads global snapshots from non-initial workflow stage", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.api.globals.workflow_config.update({ title: "Draft v1" }, ctx);
		await app.api.globals.workflow_config.update(
			{ title: "Published v1" },
			createTestContext({ accessMode: "system", stage: "published" }),
		);
		await app.api.globals.workflow_config.update({ title: "Draft v2" }, ctx);

		const draft = await app.api.globals.workflow_config.get({}, ctx);
		expect(draft?.title).toBe("Draft v2");

		const published = await app.api.globals.workflow_config.get(
			{ stage: "published" },
			ctx,
		);
		expect(published?.title).toBe("Published v1");
	});

	it("enforces global workflow stage transitions", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.api.globals.guarded_workflow_config.update(
			{ title: "Draft" },
			ctx,
		);

		await expect(
			app.api.globals.guarded_workflow_config.update(
				{ title: "Invalid publish" },
				createTestContext({ accessMode: "system", stage: "published" }),
			),
		).rejects.toThrow('Transition from "draft" to "published" is not allowed');

		await app.api.globals.guarded_workflow_config.update(
			{ title: "Review" },
			createTestContext({ accessMode: "system", stage: "review" }),
		);

		await app.api.globals.guarded_workflow_config.update(
			{ title: "Published" },
			createTestContext({ accessMode: "system", stage: "published" }),
		);

		await expect(
			app.api.globals.guarded_workflow_config.update(
				{ title: "Back to draft" },
				createTestContext({ accessMode: "system" }),
			),
		).rejects.toThrow('Transition from "published" to "draft" is not allowed');
	});
});
