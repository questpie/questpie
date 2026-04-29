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

	test("user collection keeps auth image URL and adds assets avatar", () => {
		const fields = starterModule.collections.user.state.fieldDefinitions;
		const imageMeta = fields.image.getMetadata() as any;
		const avatarMeta = fields.avatar.getMetadata() as any;

		expect(imageMeta.type).toBe("url");
		expect(avatarMeta.type).toBe("relation");
		expect(avatarMeta.isUpload).toBe(true);
		expect(avatarMeta.targetCollection).toBe("assets");
		expect(avatarMeta.relationType).toBe("belongsTo");
	});

	test("sets default access to require authentication", () => {
		const access = starterModule.config?.app?.access;
		expect(access).toBeDefined();

		const ctx = { session: { id: "test" } } as any;
		const noAuth = { session: null } as any;

		expect(access.read(ctx)).toBe(true);
		expect(access.create(ctx)).toBe(true);
		expect(access.update(ctx)).toBe(true);
		expect(access.delete(ctx)).toBe(true);

		expect(access.read(noAuth)).toBe(false);
		expect(access.create(noAuth)).toBe(false);
		expect(access.update(noAuth)).toBe(false);
		expect(access.delete(noAuth)).toBe(false);
	});

	test("has module name", () => {
		expect(starterModule.name).toBe("questpie-starter");
	});
});
