/**
 * The `locale` option must beat the context's locale.
 *
 * Request locale is expressible two ways — as a field on the CRUDContext, and
 * as an option on the call — and only the context spelling was honoured.
 * `GlobalGetOptions.locale` / `.localeFallback` are exported, documented
 * ("Override locale for this request", and globals.mdx shows
 * `get({ locale: "sk" }, …)`), and were dropped on the floor: both generators
 * built the normalized context as `{ ...context, stage: … }` and lifted nothing
 * else out of the options.
 *
 * It stayed hidden because over HTTP nothing breaks — `resolveContext` parses
 * the same query parameters into the context independently. Only the
 * documented server-side call silently returned the wrong translation.
 *
 * The equality asserted here is the contract: passing a locale as an option is
 * the same as having it on the context.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const banner = global("banner").fields(({ f }) => ({
	headline: f.textarea().localized(),
}));

const notice = collection("notice").fields(({ f }) => ({
	slug: f.text(50).required(),
	body: f.textarea().localized(),
}));

describe("locale passed as an option", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			globals: { banner },
			collections: { notice },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("globals: get({ locale }) matches a context carrying that locale", async () => {
		await setup.app.globals.banner.update(
			{ headline: "Hello" },
			createTestContext({ locale: "en" }),
		);
		await setup.app.globals.banner.update(
			{ headline: "Ahoj" },
			createTestContext({ locale: "sk" }),
		);

		const viaContext = await setup.app.globals.banner.get(
			{},
			createTestContext({ locale: "sk" }),
		);
		const viaOption = await setup.app.globals.banner.get(
			{ locale: "sk" },
			createTestContext({ locale: "en" }),
		);

		expect((viaContext as any)?.headline).toBe("Ahoj");
		expect((viaOption as any)?.headline).toBe((viaContext as any)?.headline);
	});

	it("collections: findOne({ locale }) matches a context carrying that locale", async () => {
		const created = await setup.app.collections.notice.create(
			{ slug: "n1", body: "Hello" },
			createTestContext({ locale: "en" }),
		);
		await setup.app.collections.notice.updateById(
			{ id: created.id, data: { body: "Ahoj" } },
			createTestContext({ locale: "sk" }),
		);

		const viaContext = await setup.app.collections.notice.findOne(
			{ where: { id: created.id } },
			createTestContext({ locale: "sk" }),
		);
		const viaOption = await setup.app.collections.notice.findOne(
			{ where: { id: created.id }, locale: "sk" },
			createTestContext({ locale: "en" }),
		);

		expect((viaContext as any)?.body).toBe("Ahoj");
		expect((viaOption as any)?.body).toBe((viaContext as any)?.body);
	});
});
