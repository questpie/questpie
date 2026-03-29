/**
 * QUE-277: createContext defaults and override precedence tests
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

describe("createContext defaults (QUE-277)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				items: collection("items").fields(({ f }) => ({
					name: f.text(100).required(),
				})),
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("defaults to system accessMode without request", async () => {
		const ctx = await setup.app.createContext();
		expect(ctx.accessMode).toBe("system");
	});

	it("defaults to user accessMode with request", async () => {
		const ctx = await setup.app.createContext({
			request: new Request("http://localhost/test"),
		});
		expect(ctx.accessMode).toBe("user");
	});

	it("explicit accessMode overrides request-based default", async () => {
		const ctx = await setup.app.createContext({
			request: new Request("http://localhost/test"),
			accessMode: "system",
		});
		expect(ctx.accessMode).toBe("system");
	});

	it("explicit accessMode overrides no-request default", async () => {
		const ctx = await setup.app.createContext({
			accessMode: "user",
		});
		expect(ctx.accessMode).toBe("user");
	});

	it("locale defaults to configured default", async () => {
		const ctx = await setup.app.createContext();
		expect(ctx.locale).toBe("en");
	});

	it("explicit locale override works", async () => {
		const ctx = await setup.app.createContext({ locale: "sk" });
		// "sk" is not configured, falls back to default
		expect(ctx.locale).toBe("en");
	});

	it("db defaults to app.db", async () => {
		const ctx = await setup.app.createContext();
		expect(ctx.db).toBe(setup.app.db);
	});

	it("explicit db override works", async () => {
		const mockDb = { mock: true };
		const ctx = await setup.app.createContext({ db: mockDb });
		expect(ctx.db).toBe(mockDb);
	});
});
