import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const posts = collection("posts")
	.fields(({ f }) => ({
		title: f.textarea().required(),
	}))
	.options({
		versioning: true,
	});

const site_config = global("site_config")
	.fields(({ f }) => ({
		siteName: f.text(100).required(),
		featuredPost: f.relation("posts").relationName("featuredPost"),
	}))
	.options({
		versioning: {
			enabled: true,
			maxVersions: 2,
		},
	});

const localized_config = global("localized_config").fields(({ f }) => ({
	title: f.textarea().localized(),
}));

const auto_config = global("auto_config").fields(({ f }) => ({
	mode: f.text(20).default("auto"),
}));

const read_only_config = global("read_only_config")
	.fields(({ f }) => ({
		mode: f.text(20).default("read"),
	}))
	.access({
		read: true,
		update: false,
	});

const field_flag_config = global("field_flag_config")
	.fields(({ f }) => ({
		title: f.text(100),
		serverOnly: f.text(100).inputFalse(),
		secret: f.text(100).outputFalse(),
		profile: f.object({
			publicNote: f.text(100),
			hidden: f.text(100).outputFalse(),
			serverOnly: f.text(100).inputFalse(),
		}),
		events: f
			.object({
				label: f.text(100),
				hidden: f.text(100).outputFalse(),
				serverOnly: f.text(100).inputFalse(),
			})
			.array(),
	}))
	.access({
		read: true,
		update: true,
	});

const field_level_config = global("field_level_config")
	.fields(({ f }) => ({
		title: f.text(100),
		secret: f.text(100).access({
			read: false,
			create: false,
			update: false,
		}),
	}))
	.access({
		read: true,
		update: true,
	});

const field_override_config = global("field_override_config")
	.fields(({ f }) => ({
		title: f.text(100),
		secret: f.text(100).access({
			read: false,
			create: false,
			update: false,
		}),
	}))
	.access({
		read: true,
		update: true,
		fields: {
			secret: {
				read: true,
				create: true,
				update: true,
			},
		},
	});

const workflow_config = global("workflow_config")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: ["draft", "published"],
				initialStage: "draft",
			},
		},
	});

const guarded_workflow_config = global("guarded_workflow_config")
	.fields(({ f }) => ({
		title: f.text().required(),
	}))
	.options({
		versioning: {
			workflow: {
				stages: {
					draft: { transitions: ["review"] },
					review: { transitions: ["published"] },
					published: { transitions: [] },
				},
				initialStage: "draft",
			},
		},
	});

describe("global CRUD", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: any; // Use any to bypass type issues with FK column names

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { posts },
			globals: {
				site_config,
				localized_config,
				auto_config,
				read_only_config,
				field_flag_config,
				field_level_config,
				field_override_config,
				workflow_config,
				guarded_workflow_config,
			},
		});
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("supports globals API, versioning, and relations", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const post = await app.collections.posts.create(
			{
				id: crypto.randomUUID(),
				title: "Hello",
			},
			ctx,
		);

		await app.globals.site_config.update(
			{
				siteName: "One",
			},
			ctx,
		);
		await app.globals.site_config.update(
			{
				siteName: "Two",
			},
			ctx,
		);
		await app.globals.site_config.update(
			{
				siteName: "Three",
				featuredPost: post.id, // Global FK columns use field name, not {field}Id
			},
			ctx,
		);

		const versions = await app.globals.site_config.findVersions({}, ctx);
		expect(versions).toHaveLength(2);
		expect(versions[0].siteName).toBe("Two");

		const fetched = await app.globals.site_config.get(
			{ with: { featuredPost: true } },
			ctx,
		);
		expect(fetched?.featuredPost?.title).toBe("Hello");

		await app.globals.site_config.revertToVersion(
			{ version: versions[0].versionNumber },
			ctx,
		);

		const reverted = await app.globals.site_config.get({}, ctx);
		expect(reverted?.siteName).toBe("Two");
	});

	it("reverts global versions by versionId", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.globals.site_config.update({ siteName: "First" }, ctx);
		await app.globals.site_config.update({ siteName: "Second" }, ctx);

		const versions = await app.globals.site_config.findVersions({}, ctx);
		await app.globals.site_config.revertToVersion(
			{ versionId: versions[0].versionId },
			ctx,
		);

		const reverted = await app.globals.site_config.get({}, ctx);
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

		await app.globals.localized_config.update({ title: "Hello" }, ctxEn);
		await app.globals.localized_config.update({ title: "Ahoj" }, ctxSk);

		const sk = await app.globals.localized_config.get({}, ctxSk);
		expect(sk?.title).toBe("Ahoj");

		const fr = await app.globals.localized_config.get({}, ctxFr);
		expect(fr?.title).toBe("Hello");
	});

	it("auto-creates globals on get", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await app.globals.auto_config.get({}, ctx);
		expect(created?.mode).toBe("auto");
	});

	it("auto-creates globals without update access", async () => {
		const ctx = createTestContext({ accessMode: "user" });
		const created = await app.globals.read_only_config.get({}, ctx);
		expect(created?.mode).toBe("read");
	});

	it("rejects user writes to global inputFalse fields", async () => {
		const userCtx = createTestContext({ accessMode: "user" });

		await expect(
			app.globals.field_flag_config.update(
				{
					title: "Flags",
					serverOnly: "client supplied",
				},
				userCtx,
			),
		).rejects.toThrow("Cannot write field 'serverOnly': access denied");
	});

	it("rejects user writes to nested global inputFalse fields", async () => {
		const userCtx = createTestContext({ accessMode: "user" });

		await expect(
			app.globals.field_flag_config.update(
				{
					title: "Flags",
					profile: {
						publicNote: "visible",
						serverOnly: "client supplied",
					},
				},
				userCtx,
			),
		).rejects.toThrow("Cannot write field 'profile.serverOnly': access denied");
	});

	it("redacts global outputFalse fields from user-mode update and get responses", async () => {
		const userCtx = createTestContext({ accessMode: "user" });

		const updated = await app.globals.field_flag_config.update(
			{
				title: "Flags",
				secret: "hidden",
				profile: {
					publicNote: "visible",
					hidden: "nested hidden",
				},
				events: [
					{
						label: "visible event",
						hidden: "nested array hidden",
					},
				],
			},
			userCtx,
		);

		expect(updated).not.toHaveProperty("secret");
		expect(updated?.profile).toEqual({ publicNote: "visible" });
		expect(updated?.events).toEqual([{ label: "visible event" }]);

		const retrieved = await app.globals.field_flag_config.get({}, userCtx);
		expect(retrieved).not.toHaveProperty("secret");
		expect(retrieved?.profile).toEqual({ publicNote: "visible" });
		expect(retrieved?.events).toEqual([{ label: "visible event" }]);

		const systemRetrieved = await app.globals.field_flag_config.get(
			{},
			createTestContext({ accessMode: "system" }),
		);
		expect(systemRetrieved?.events).toEqual([
			{
				label: "visible event",
				hidden: "nested array hidden",
			},
		]);
	});

	it("allows system mode to write and read global input/output flagged fields", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });

		const updated = await app.globals.field_flag_config.update(
			{
				title: "Flags",
				serverOnly: "server supplied",
				secret: "system visible",
				profile: {
					publicNote: "visible",
					hidden: "nested hidden",
					serverOnly: "nested server supplied",
				},
				events: [
					{
						label: "visible event",
						hidden: "nested array hidden",
						serverOnly: "nested array server supplied",
					},
				],
			},
			systemCtx,
		);

		expect(updated?.serverOnly).toBe("server supplied");
		expect(updated?.secret).toBe("system visible");
		expect(updated?.profile).toEqual({
			publicNote: "visible",
			hidden: "nested hidden",
			serverOnly: "nested server supplied",
		});
		expect(updated?.events).toEqual([
			{
				label: "visible event",
				hidden: "nested array hidden",
				serverOnly: "nested array server supplied",
			},
		]);
	});

	it("enforces global f.access() declarations for user-mode read and write", async () => {
		const userCtx = createTestContext({ accessMode: "user" });
		const systemCtx = createTestContext({ accessMode: "system" });

		await expect(
			app.globals.field_level_config.update(
				{
					title: "Field access",
					secret: "client supplied",
				},
				userCtx,
			),
		).rejects.toThrow("Cannot write field 'secret': access denied");

		await app.globals.field_level_config.update(
			{
				title: "Field access",
				secret: "system supplied",
			},
			systemCtx,
		);

		const retrieved = await app.globals.field_level_config.get({}, userCtx);
		expect(retrieved).not.toHaveProperty("secret");
	});

	it("lets global-level field access override field-level access declarations", async () => {
		const userCtx = createTestContext({ accessMode: "user" });

		const updated = await app.globals.field_override_config.update(
			{
				title: "Override",
				secret: "allowed",
			},
			userCtx,
		);
		expect(updated?.secret).toBe("allowed");

		const retrieved = await app.globals.field_override_config.get({}, userCtx);
		expect(retrieved?.secret).toBe("allowed");
	});

	it("reads global snapshots from non-initial workflow stage", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.globals.workflow_config.update({ title: "Draft v1" }, ctx);
		await app.globals.workflow_config.update(
			{ title: "Published v1" },
			createTestContext({ accessMode: "system", stage: "published" }),
		);
		await app.globals.workflow_config.update({ title: "Draft v2" }, ctx);

		const draft = await app.globals.workflow_config.get({}, ctx);
		expect(draft?.title).toBe("Draft v2");

		const published = await app.globals.workflow_config.get(
			{ stage: "published" },
			ctx,
		);
		expect(published?.title).toBe("Published v1");
	});

	it("enforces global workflow stage transitions", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await app.globals.guarded_workflow_config.update({ title: "Draft" }, ctx);

		await expect(
			app.globals.guarded_workflow_config.update(
				{ title: "Invalid publish" },
				createTestContext({ accessMode: "system", stage: "published" }),
			),
		).rejects.toThrow('Transition from "draft" to "published" is not allowed');

		await app.globals.guarded_workflow_config.update(
			{ title: "Review" },
			createTestContext({ accessMode: "system", stage: "review" }),
		);

		await app.globals.guarded_workflow_config.update(
			{ title: "Published" },
			createTestContext({ accessMode: "system", stage: "published" }),
		);

		await expect(
			app.globals.guarded_workflow_config.update(
				{ title: "Back to draft" },
				createTestContext({ accessMode: "system" }),
			),
		).rejects.toThrow('Transition from "published" to "draft" is not allowed');
	});
});
