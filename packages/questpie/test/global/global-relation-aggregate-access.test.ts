import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let noteAccess: boolean | { visible: boolean } = true;

const notes = collection("rx_global_notes")
	.fields(({ f }) => ({
		settings: f.relation("rx_global_settings").relationName("settings"),
		visible: f.boolean(),
		weight: f.number(),
	}))
	.options({ softDelete: true })
	.access({ read: () => noteAccess, create: true, delete: true });

const settings = global("rx_global_settings")
	.fields(({ f }) => ({
		title: f.text(),
		notes: f
			.relation("rx_global_notes")
			.hasMany({ foreignKey: "settings", relationName: "settings" }),
	}))
	.access({ read: true, update: true });

async function status(run: () => Promise<unknown>): Promise<number | "ok"> {
	try {
		await run();
		return "ok";
	} catch (error: any) {
		if (typeof error?.getHTTPStatus !== "function") throw error;
		return error.getHTTPStatus();
	}
}

describe("global hasMany relation aggregates", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const system = createTestContext({ accessMode: "system" });
	const user = createTestContext({ accessMode: "user" });
	const counted = (context: any) =>
		setup.app.globals.rx_global_settings.get(
			{
				with: {
					notes: { _aggregate: { _count: true, _sum: { weight: true } } },
				},
			} as any,
			context,
		) as Promise<any>;

	beforeEach(async () => {
		noteAccess = true;
		setup = await buildMockApp({
			collections: { rx_global_notes: notes },
			globals: { rx_global_settings: settings },
		});
		await runTestDbMigrations(setup.app);
		const row: any = await setup.app.globals.rx_global_settings.get({}, system);
		const create = (data: object) =>
			setup.app.collections.rx_global_notes.create(
				{ settings: row.id, ...data } as any,
				system,
			) as Promise<any>;
		await create({ visible: true, weight: 1 });
		await create({ visible: true, weight: 2 });
		await create({ visible: false, weight: 100 });
		const removed = await create({ visible: true, weight: 1000 });
		await setup.app.collections.rx_global_notes.deleteById(
			{ id: removed.id },
			system,
		);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("refuses the aggregate when the target collection denies the read", async () => {
		noteAccess = false;
		expect(
			await status(() =>
				setup.app.globals.rx_global_settings.get(
					{ with: { notes: true } } as any,
					user,
				),
			),
		).toBe(403);
		expect(await status(() => counted(user))).toBe(403);
	});

	it("aggregates only the rows the target's access rule and soft delete admit", async () => {
		noteAccess = { visible: true };
		expect((await counted(user)).notes).toEqual({
			_count: 2,
			_sum: { weight: 3 },
		});
		expect((await counted(system)).notes).toEqual({
			_count: 3,
			_sum: { weight: 103 },
		});
	});
});
