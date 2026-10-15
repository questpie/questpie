import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

describe("relation metadata without unrelated CRUD (QFM-28)", () => {
	const cleanups: Array<() => Promise<void>> = [];
	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});
	it("reads relation metadata without generating unrelated collection or global CRUD", async () => {
		const parents = collection("metadata_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const children = collection("metadata_children")
			.fields(({ f }) => ({ parent: f.relation("parents").required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const unrelated = collection("metadata_unrelated").fields(({ f }) => ({
			name: f.text(),
		}));
		const settings = global("metadata_settings").fields(({ f }) => ({
			name: f.text(),
		}));
		const setup = await buildMockApp({
			collections: { parents, children, unrelated },
			globals: { settings },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const collectionGeneration = spyOn(
			setup.app.getCollections().unrelated,
			"generateCRUD",
		);
		const globalGeneration = spyOn(
			setup.app.getGlobals().settings,
			"generateCRUD",
		);
		try {
			const ctx = { accessMode: "system" as const };
			const parent = await setup.app.collections.parents.create(
				{ name: "Parent" },
				ctx,
			);
			const child = await setup.app.collections.children.create(
				{ parent: parent.id },
				ctx,
			);
			await setup.app.collections.parents.deleteById({ id: parent.id }, ctx);
			await expect(
				setup.app.collections.parents.purgeById({ id: parent.id }, ctx),
			).rejects.toMatchObject({
				code: "CONFLICT",
				message: "Cannot purge record while retained references exist",
			});
			await setup.app.collections.children.deleteById({ id: child.id }, ctx);
			await setup.app.collections.children.purgeById({ id: child.id }, ctx);
			await setup.app.collections.parents.purgeById({ id: parent.id }, ctx);
			expect(
				await setup.app.collections.parents.findOne(
					{ where: { id: parent.id } },
					ctx,
				),
			).toBeNull();
			expect(collectionGeneration).not.toHaveBeenCalled();
			expect(globalGeneration).not.toHaveBeenCalled();
		} finally {
			collectionGeneration.mockRestore();
			globalGeneration.mockRestore();
		}
	});

	it("validates aliased global targets before collection create and update", async () => {
		const settings = global("metadata_global_target").fields(({ f }) => ({
			name: f.text(),
		}));
		const holders = collection("metadata_global_holders").fields(({ f }) => ({
			settings: f.relation("settings").required(),
		}));
		const setup = await buildMockApp({
			collections: { holders },
			globals: { settings },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = { accessMode: "system" as const };
		const target = await setup.app.globals.settings.update(
			{ name: "Settings" },
			ctx,
		);
		const holder = await setup.app.collections.holders.create(
			{ settings: target.id },
			ctx,
		);
		const missingId = crypto.randomUUID();
		const denial = {
			code: "BAD_REQUEST",
			message: 'Relation target "settings.id" does not exist',
		};
		await expect(
			setup.app.collections.holders.create({ settings: missingId }, ctx),
		).rejects.toMatchObject(denial);
		await expect(
			setup.app.collections.holders.updateById(
				{ id: holder.id, data: { settings: missingId } },
				ctx,
			),
		).rejects.toMatchObject(denial);
		expect(
			await setup.app.collections.holders.findOne(
				{ where: { id: holder.id } },
				ctx,
			),
		).toMatchObject({ settings: target.id });
		expect(
			(await setup.app.collections.holders.find({}, ctx)).docs,
		).toHaveLength(1);
	});
});
