import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

describe("physical purge relation safety", () => {
	const cleanups: Array<() => Promise<void>> = [];

	afterEach(async () => {
		await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
	});

	it("blocks retained application references including soft-deleted cascade children", async () => {
		const parents = collection("purge_relation_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const children = collection("purge_relation_children")
			.fields(({ f }) => ({
				name: f.text().required(),
				parent: f
					.relation("purge_relation_parents")
					.required()
					.onDelete("cascade"),
			}))
			.options({ softDelete: true });
		const setup = await buildMockApp({
			collections: {
				purge_relation_parents: parents,
				purge_relation_children: children,
			},
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const parent = await setup.app.collections.purge_relation_parents.create(
			{ name: "Parent" },
			ctx,
		);
		const child = await setup.app.collections.purge_relation_children.create(
			{ name: "Child", parent: parent.id },
			ctx,
		);
		await setup.app.collections.purge_relation_children.deleteById(
			{ id: child.id },
			ctx,
		);
		await setup.app.collections.purge_relation_parents.deleteById(
			{ id: parent.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_relation_parents.purgeById(
				{ id: parent.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});

		const parentRows = await setup.app.db
			.select()
			.from(
				setup.app.collections.purge_relation_parents["~internalRelatedTable"],
			);
		const childRows = await setup.app.db
			.select()
			.from(
				setup.app.collections.purge_relation_children["~internalRelatedTable"],
			);
		expect(parentRows).toHaveLength(1);
		expect(childRows).toHaveLength(1);
		expect(childRows[0]?.deletedAt).toBeInstanceOf(Date);
	});

	it("preflights raw database ON DELETE CASCADE instead of hard-deleting its child", async () => {
		const parent = collection("purge_raw_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true })
			.build();
		const children = collection("purge_raw_children").fields(({ f }) => ({
			name: f.text().required(),
			parentId: f.text(36).drizzle((column) =>
				column.references(() => parent.table.id, {
					onDelete: "cascade",
				}),
			),
		}));
		const setup = await buildMockApp({
			collections: { parent, children },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const createdParent = await setup.app.collections.parent.create(
			{ name: "Parent" },
			ctx,
		);
		const createdChild = await setup.app.collections.children.create(
			{ name: "Child", parentId: createdParent.id },
			ctx,
		);
		await setup.app.collections.parent.deleteById(
			{ id: createdParent.id },
			ctx,
		);

		await expect(
			setup.app.collections.parent.purgeById({ id: createdParent.id }, ctx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});

		const childRows = await setup.app.collections.children.find(
			{ where: { id: createdChild.id } },
			ctx,
		);
		expect(childRows.docs).toHaveLength(1);
	});

	it("fails closed when an incoming relation shape cannot be scanned soundly", async () => {
		const parents = collection("purge_unknown_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: ({ session }) => session?.user.id === "allowed" });
		const holders = collection("purge_unknown_holders").fields(({ f }) => ({
			parents: f.relation("purge_unknown_parents").multiple(),
		}));
		const setup = await buildMockApp({
			collections: {
				purge_unknown_parents: parents,
				purge_unknown_holders: holders,
			},
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const created = await setup.app.collections.purge_unknown_parents.create(
			{ name: "Parent" },
			ctx,
		);
		await setup.app.collections.purge_unknown_parents.deleteById(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_unknown_parents.purgeById(
				{ id: created.id },
				createTestContext({
					accessMode: "user",
					session: createMockSession({ id: "denied" }),
				}),
			),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		await expect(
			setup.app.collections.purge_unknown_parents.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});
	});

	it("blocks another row in an application-only self relation", async () => {
		const nodes = collection("purge_relation_nodes")
			.fields(({ f }) => ({
				name: f.text().required(),
				parent: f.relation("purge_relation_nodes"),
			}))
			.options({ softDelete: true })
			.access({ purge: true });
		const setup = await buildMockApp({
			collections: { purge_relation_nodes: nodes },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const parent = await setup.app.collections.purge_relation_nodes.create(
			{ name: "Parent" },
			ctx,
		);
		await setup.app.collections.purge_relation_nodes.create(
			{ name: "Child", parent: parent.id },
			ctx,
		);
		await setup.app.collections.purge_relation_nodes.deleteById(
			{ id: parent.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_relation_nodes.purgeById(
				{ id: parent.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});
	});
});
