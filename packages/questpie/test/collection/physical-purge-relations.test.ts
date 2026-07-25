import { afterEach, describe, expect, it } from "bun:test";

import { collection, global } from "../../src/exports/index.js";
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

	it("uses the registered collection key when inventorying incoming relations", async () => {
		const parents = collection("purge_aliased_physical_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const children = collection("purge_aliased_children").fields(({ f }) => ({
			parent: f.relation("parents").required(),
		}));
		const setup = await buildMockApp({
			collections: { parents, children },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const parent = await setup.app.collections.parents.create(
			{ name: "Parent" },
			ctx,
		);
		await setup.app.collections.children.create({ parent: parent.id }, ctx);
		await setup.app.collections.parents.deleteById({ id: parent.id }, ctx);

		await expect(
			setup.app.collections.parents.purgeById({ id: parent.id }, ctx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});
	});

	it("does not let an unrelated unsupported many-to-many block purge", async () => {
		const targets = collection("purge_scoped_targets")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const unrelated = collection("purge_scoped_unrelated").fields(({ f }) => ({
			tags: f.relation("tags").manyToMany({
				through: "junction",
				sourceField: "source",
				targetField: "target",
			}),
		}));
		const tags = collection("purge_scoped_tags").fields(({ f }) => ({
			name: f.text().required(),
		}));
		const junction = collection("purge_scoped_junction").fields(({ f }) => ({
			source: f.relation("unrelated"),
			target: f.relation("tags"),
		}));
		const setup = await buildMockApp({
			collections: { targets, unrelated, tags, junction },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		setup.app.collections.unrelated["~internalState"].relations.tags.through =
			"missing_junction";
		const ctx = createTestContext();
		const target = await setup.app.collections.targets.create(
			{ name: "Target" },
			ctx,
		);
		await setup.app.collections.targets.deleteById({ id: target.id }, ctx);

		await expect(
			setup.app.collections.targets.purgeById({ id: target.id }, ctx),
		).resolves.toEqual({ success: true });
	});

	it("blocks retained references owned by globals", async () => {
		const parents = collection("purge_global_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const settings = global("purge_global_settings").fields(({ f }) => ({
			featuredParent: f.relation("parents"),
		}));
		const setup = await buildMockApp({
			collections: { parents },
			globals: { settings },
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const parent = await setup.app.collections.parents.create(
			{ name: "Parent" },
			ctx,
		);
		const settingsTable = setup.app.globals.settings["~internalRelatedTable"];
		await setup.app.db
			.insert(settingsTable)
			.values({ featuredParent: parent.id });
		await setup.app.collections.parents.deleteById({ id: parent.id }, ctx);

		await expect(
			setup.app.collections.parents.purgeById({ id: parent.id }, ctx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});
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

	it("rescans physical references written by beforePurge and rolls them back", async () => {
		const parent = collection("purge_hook_raw_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true })
			.build();
		const children = collection("purge_hook_raw_children")
			.fields(({ f }) => ({
				name: f.text().required(),
				parentId: f.text(36).drizzle((column) =>
					column.references(() => parent.table.id, {
						onDelete: "cascade",
					}),
				),
			}))
			.build();
		let targetId: string | undefined;
		const setup = await buildMockApp({
			collections: { parent, children },
			hooks: {
				collections: [
					{
						beforePurge: async ({ data, db }) => {
							if (data.id !== targetId) return;
							await db.insert(children.table).values({
								name: "Inserted inside beforePurge",
								parentId: data.id,
							});
						},
					},
				],
				globals: [],
			},
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const created = await setup.app.collections.parent.create(
			{ name: "Parent" },
			ctx,
		);
		targetId = created.id;
		await setup.app.collections.parent.deleteById({ id: created.id }, ctx);

		await expect(
			setup.app.collections.parent.purgeById({ id: created.id }, ctx),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});

		expect(await setup.app.db.select().from(parent.table)).toHaveLength(1);
		expect(await setup.app.db.select().from(children.table)).toHaveLength(0);
	});

	it("rescans application references written by afterPurge and rolls them back", async () => {
		const parents = collection("purge_hook_app_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const children = collection("purge_hook_app_children").fields(({ f }) => ({
			name: f.text().required(),
			parent: f.relation("purge_hook_app_parents").required(),
		}));
		let targetId: string | undefined;
		let childTable: any;
		const setup = await buildMockApp({
			collections: {
				purge_hook_app_parents: parents,
				purge_hook_app_children: children,
			},
			hooks: {
				collections: [
					{
						afterPurge: async ({ data, db }) => {
							if (data.id !== targetId) return;
							await db.insert(childTable).values({
								name: "Inserted inside afterPurge",
								parent: data.id,
							});
						},
					},
				],
				globals: [],
			},
		});
		cleanups.push(setup.cleanup);
		childTable =
			setup.app.collections.purge_hook_app_children["~internalRelatedTable"];
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const created = await setup.app.collections.purge_hook_app_parents.create(
			{ name: "Parent" },
			ctx,
		);
		targetId = created.id;
		await setup.app.collections.purge_hook_app_parents.deleteById(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_hook_app_parents.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});

		expect(
			await setup.app.db
				.select()
				.from(
					setup.app.collections.purge_hook_app_parents["~internalRelatedTable"],
				),
		).toHaveLength(1);
		expect(await setup.app.db.select().from(childTable)).toHaveLength(0);
	});

	it("cannot redirect the final relation rescan by mutating purge hook data", async () => {
		const parents = collection("purge_hook_mutation_parents")
			.fields(({ f }) => ({ name: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const children = collection("purge_hook_mutation_children").fields(
			({ f }) => ({
				name: f.text().required(),
				parent: f.relation("purge_hook_mutation_parents").required(),
			}),
		);
		let targetId: string | undefined;
		let childTable: any;
		const setup = await buildMockApp({
			collections: {
				purge_hook_mutation_parents: parents,
				purge_hook_mutation_children: children,
			},
			hooks: {
				collections: [
					{
						beforePurge: async ({ data, db }) => {
							if (data.id !== targetId || !targetId) return;
							await db.insert(childTable).values({
								name: "Inserted before mutating the hook snapshot",
								parent: targetId,
							});
							Reflect.set(data, "id", crypto.randomUUID());
						},
					},
				],
				globals: [],
			},
		});
		cleanups.push(setup.cleanup);
		childTable =
			setup.app.collections.purge_hook_mutation_children[
				"~internalRelatedTable"
			];
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const created =
			await setup.app.collections.purge_hook_mutation_parents.create(
				{ name: "Parent" },
				ctx,
			);
		targetId = created.id;
		await setup.app.collections.purge_hook_mutation_parents.deleteById(
			{ id: created.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_hook_mutation_parents.purgeById(
				{ id: created.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});

		expect(
			await setup.app.db
				.select()
				.from(
					setup.app.collections.purge_hook_mutation_parents[
						"~internalRelatedTable"
					],
				),
		).toHaveLength(1);
		expect(await setup.app.db.select().from(childTable)).toHaveLength(0);
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

	it("rejects create and update writes to a missing application-only target", async () => {
		const parents = collection("purge_validated_parents").fields(({ f }) => ({
			name: f.text().required(),
		}));
		const children = collection("purge_validated_children").fields(({ f }) => ({
			name: f.text().required(),
			parent: f.relation("purge_validated_parents").required(),
		}));
		const setup = await buildMockApp({
			collections: {
				purge_validated_parents: parents,
				purge_validated_children: children,
			},
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const missingId = crypto.randomUUID();

		await expect(
			setup.app.collections.purge_validated_children.create(
				{ name: "Dangling", parent: missingId },
				ctx,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		const firstParent =
			await setup.app.collections.purge_validated_parents.create(
				{ name: "First" },
				ctx,
			);
		const child = await setup.app.collections.purge_validated_children.create(
			{ name: "Valid", parent: firstParent.id },
			ctx,
		);
		await expect(
			setup.app.collections.purge_validated_children.updateById(
				{ id: child.id, data: { parent: missingId } },
				ctx,
			),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });

		const retained =
			await setup.app.collections.purge_validated_children.findOne(
				{ where: { id: child.id } },
				ctx,
			);
		expect(retained?.parent).toBe(firstParent.id);
	});

	it("inspects every morphTo discriminator instead of only its first target", async () => {
		const articles = collection("purge_poly_articles")
			.fields(({ f }) => ({ title: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const comments = collection("purge_poly_comments")
			.fields(({ f }) => ({ body: f.text().required() }))
			.options({ softDelete: true })
			.access({ purge: true });
		const activities = collection("purge_poly_activities").fields(({ f }) => ({
			subject: f.relation({
				article: "purge_poly_articles",
				comment: "purge_poly_comments",
			} as any),
		}));
		const setup = await buildMockApp({
			collections: {
				purge_poly_articles: articles,
				purge_poly_comments: comments,
				purge_poly_activities: activities,
			},
		});
		cleanups.push(setup.cleanup);
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();
		const referenced = await setup.app.collections.purge_poly_comments.create(
			{ body: "Referenced" },
			ctx,
		);
		const unrelated = await setup.app.collections.purge_poly_comments.create(
			{ body: "Wrong discriminator" },
			ctx,
		);
		await setup.app.collections.purge_poly_articles.create(
			{ id: unrelated.id, title: "Matching article identity" },
			ctx,
		);
		const activitiesTable =
			setup.app.collections.purge_poly_activities["~internalRelatedTable"];
		expect(
			setup.app.collections.purge_poly_activities["~internalState"].relations
				.subject.polymorphicTargets,
		).toEqual([
			{
				discriminator: "article",
				collection: "purge_poly_articles",
				typeField: "subjectType",
				idField: "subjectId",
			},
			{
				discriminator: "comment",
				collection: "purge_poly_comments",
				typeField: "subjectType",
				idField: "subjectId",
			},
		]);
		const referencedActivity =
			await setup.app.collections.purge_poly_activities.create(
				{
					subject: { type: "comment", id: referenced.id },
				},
				ctx,
			);
		const unrelatedActivity =
			await setup.app.collections.purge_poly_activities.create(
				{
					subject: { type: "article", id: unrelated.id },
				},
				ctx,
			);
		expect(referencedActivity).toMatchObject({
			subject: { type: "comment", id: referenced.id },
		});
		expect(unrelatedActivity.subject).toEqual({
			type: "article",
			id: unrelated.id,
		});
		expect(
			(await setup.app.db.select().from(activitiesTable)).map((row: any) => [
				row.subjectType,
				row.subjectId,
			]),
		).toEqual([
			["comment", referenced.id],
			["article", unrelated.id],
		]);
		const replacement = await setup.app.collections.purge_poly_comments.create(
			{ body: "Replacement" },
			ctx,
		);
		const updatedActivity =
			await setup.app.collections.purge_poly_activities.updateById(
				{
					id: referencedActivity.id,
					data: { subject: { type: "comment", id: replacement.id } },
				},
				ctx,
			);
		expect(updatedActivity.subject).toEqual({
			type: "comment",
			id: replacement.id,
		});
		await setup.app.collections.purge_poly_activities.updateById(
			{
				id: referencedActivity.id,
				data: { subject: { type: "comment", id: referenced.id } },
			},
			ctx,
		);
		await setup.app.collections.purge_poly_comments.deleteById(
			{ id: referenced.id },
			ctx,
		);
		await setup.app.collections.purge_poly_comments.deleteById(
			{ id: unrelated.id },
			ctx,
		);

		await expect(
			setup.app.collections.purge_poly_comments.purgeById(
				{ id: referenced.id },
				ctx,
			),
		).rejects.toMatchObject({
			code: "CONFLICT",
			message: "Cannot purge record while retained references exist",
		});
		await expect(
			setup.app.collections.purge_poly_comments.purgeById(
				{ id: unrelated.id },
				ctx,
			),
		).resolves.toEqual({ success: true });
	});
});
