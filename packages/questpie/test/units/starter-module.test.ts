import { describe, expect, test } from "bun:test";
import starterModule from "../../src/server/modules/starter/.generated/module.js";

describe("starterModule", () => {
	test("registers realtime cleanup cron job", () => {
		const realtimeCleanup = starterModule.jobs.realtimeCleanup;

		expect(realtimeCleanup).toBeDefined();
		expect(realtimeCleanup.name).toBe("questpie.realtime.cleanup");
		expect(realtimeCleanup.options?.cron).toBe("0 * * * *");
		expect(realtimeCleanup.schema.parse({})).toEqual({});
	});

	test("realtime cleanup job calls realtime service cleanup", async () => {
		const realtimeCleanup = starterModule.jobs.realtimeCleanup;
		let called = 0;

		await realtimeCleanup.handler({
			payload: {},
			realtime: {
				cleanupOutbox: async (force: boolean) => {
					expect(force).toBe(true);
					called += 1;
				},
			},
			db: {},
		} as any);

		expect(called).toBe(1);
	});

	test("includes all expected collections", () => {
		expect(starterModule.collections).toBeDefined();
		expect(starterModule.collections.user).toBeDefined();
		expect(starterModule.collections.assets).toBeDefined();
		expect(starterModule.collections.session).toBeDefined();
		expect(starterModule.collections.account).toBeDefined();
		expect(starterModule.collections.verification).toBeDefined();
		expect(starterModule.collections.apikey).toBeDefined();
	});

	test("sets default access to require authentication", () => {
		expect(starterModule.defaultAccess).toBeDefined();

		const ctx = { session: { id: "test" } } as any;
		const noAuth = { session: null } as any;

		expect(starterModule.defaultAccess.read(ctx)).toBe(true);
		expect(starterModule.defaultAccess.create(ctx)).toBe(true);
		expect(starterModule.defaultAccess.update(ctx)).toBe(true);
		expect(starterModule.defaultAccess.delete(ctx)).toBe(true);

		expect(starterModule.defaultAccess.read(noAuth)).toBe(false);
		expect(starterModule.defaultAccess.create(noAuth)).toBe(false);
		expect(starterModule.defaultAccess.update(noAuth)).toBe(false);
		expect(starterModule.defaultAccess.delete(noAuth)).toBe(false);
	});

	test("has module name", () => {
		expect(starterModule.name).toBe("questpie-starter");
	});
});
