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
	});

describe("global CRUD", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp<typeof testModule>>>;
	let cms: any; // Use any to bypass type issues with FK column names

	beforeEach(async () => {
		setup = await buildMockApp(testModule);
		cms = setup.cms;
		await runTestDbMigrations(cms);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("supports globals API, versioning, and relations", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		const post = await cms.api.collections.posts.create(
			{
				id: crypto.randomUUID(),
				title: "Hello",
			},
			ctx,
		);

		await cms.api.globals.site_config.update(
			{
				siteName: "One",
			},
			ctx,
		);
		await cms.api.globals.site_config.update(
			{
				siteName: "Two",
			},
			ctx,
		);
		await cms.api.globals.site_config.update(
			{
				siteName: "Three",
				featuredPost: post.id, // Global FK columns use field name, not {field}Id
			},
			ctx,
		);

		const versions = await cms.api.globals.site_config.findVersions({}, ctx);
		expect(versions).toHaveLength(2);
		expect(versions[0].siteName).toBe("Two");

		const fetched = await cms.api.globals.site_config.get(
			{ with: { featuredPost: true } },
			ctx,
		);
		expect(fetched?.featuredPost?.title).toBe("Hello");

		await cms.api.globals.site_config.revertToVersion(
			{ version: versions[0].versionNumber },
			ctx,
		);

		const reverted = await cms.api.globals.site_config.get({}, ctx);
		expect(reverted?.siteName).toBe("Two");
	});

	it("reverts global versions by versionId", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		await cms.api.globals.site_config.update({ siteName: "First" }, ctx);
		await cms.api.globals.site_config.update({ siteName: "Second" }, ctx);

		const versions = await cms.api.globals.site_config.findVersions({}, ctx);
		await cms.api.globals.site_config.revertToVersion(
			{ versionId: versions[0].versionId },
			ctx,
		);

		const reverted = await cms.api.globals.site_config.get({}, ctx);
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

		await cms.api.globals.localized_config.update({ title: "Hello" }, ctxEn);
		await cms.api.globals.localized_config.update({ title: "Ahoj" }, ctxSk);

		const sk = await cms.api.globals.localized_config.get({}, ctxSk);
		expect(sk?.title).toBe("Ahoj");

		const fr = await cms.api.globals.localized_config.get({}, ctxFr);
		expect(fr?.title).toBe("Hello");
	});

	it("auto-creates globals on get", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const created = await cms.api.globals.auto_config.get({}, ctx);
		expect(created?.mode).toBe("auto");
	});

	it("auto-creates globals without update access", async () => {
		const ctx = createTestContext({ accessMode: "user" });
		const created = await cms.api.globals.read_only_config.get({}, ctx);
		expect(created?.mode).toBe("read");
	});
});
