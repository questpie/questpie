import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sql } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { getCurrentTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

type ObservedWrite = {
	method: string;
	operation: string;
	original: unknown;
	exactTransaction: boolean;
	originals?: unknown[];
	batchEntryNames?: string[];
	count?: number;
};

const observedWrites: ObservedWrite[] = [];
const rejectedMethods = new Set<string>();
const beforeChangeNames: string[] = [];
const observedDependentRows: Record<string, unknown>[] = [];
const observedLogicalPayloads: unknown[] = [];
const composedGuardPhases: string[] = [];

const factTargets = collection("fact_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
		localizedName: f.text().localized(),
		status: f.text().required(),
		statusUpper: f.text().virtual(sql<string>`UPPER(fact_targets.status)`),
	}))
	.title(({ f }) => f.localizedName)
	.options({ softDelete: true });

const guardEffects = collection("guard_effects").fields(({ f }) => ({
	recordId: f.text().required(),
	name: f.text().required(),
}));

const guardedRecords = collection("guarded_records")
	.fields(({ f }) => ({
		name: f.text().required(),
		localizedName: f.text().localized(),
		nameUpper: f.text().virtual(sql<string>`UPPER(guarded_records.name)`),
		target: f.relation("factTargets"),
		subject: f.relation({ factTarget: "factTargets", effect: "guardEffects" }),
	}))
	.title(({ f }) => f.localizedName)
	.options({ optimisticConcurrency: true, softDelete: true })
	.hooks({
		beforeChange: ({ data, operation }) => {
			if (operation === "update" && data.name)
				beforeChangeNames.push(data.name);
		},
		beforeWrite: {
			locks: (ctx: any) => {
				const newTargetIds =
					ctx.method === "updateBatch"
						? ctx.data.flatMap((entry: { data: { target?: string | null } }) =>
								entry.data.target ? [entry.data.target] : [],
							)
						: ctx.data.target
							? [ctx.data.target]
							: [];
				const targetIds = [
					...newTargetIds,
					...ctx.originals.flatMap((row: { target?: string | null }) =>
						row.target ? [row.target] : [],
					),
				];
				return targetIds.length > 0
					? [{ collection: "factTargets", ids: targetIds }]
					: [];
			},
			run: async (ctx: any) => {
				observedLogicalPayloads.push(ctx.data);
				const newTargetIds =
					ctx.method === "updateBatch"
						? ctx.data.flatMap((entry: { data: { target?: string | null } }) =>
								entry.data.target ? [entry.data.target] : [],
							)
						: ctx.data.target
							? [ctx.data.target]
							: [];
				const targetIds = [
					...newTargetIds,
					...ctx.originals.flatMap((row: { target?: string | null }) =>
						row.target ? [row.target] : [],
					),
				];
				const uniqueTargetIds = [...new Set(targetIds)];
				const targets =
					uniqueTargetIds.length === 0
						? []
						: (
								await ctx.collections.factTargets.find(
									{
										where: { id: { in: uniqueTargetIds } },
										includeDeleted: true,
									},
									ctx,
								)
							).docs;
				observedDependentRows.push(...targets);
				observedWrites.push({
					method: ctx.method,
					operation: ctx.operation,
					original: ctx.original,
					exactTransaction: ctx.db === getCurrentTransaction(),
					...(ctx.originals.length > 0 ? { originals: ctx.originals } : {}),
					...(ctx.method === "updateBatch"
						? {
								batchEntryNames: ctx.data.map(
									(entry: { data: { name: string } }) => entry.data.name,
								),
								count: ctx.count,
							}
						: {}),
				});
				if (
					targets.length !== uniqueTargetIds.length ||
					targets.some(
						(target: { status: string; deletedAt?: Date | null }) =>
							target.status !== "active" || target.deletedAt != null,
					)
				) {
					throw new Error("dependent target inactive");
				}
				if (ctx.data.name === "Reject") {
					throw new Error("dependent facts rejected");
				}
				if (rejectedMethods.has(ctx.method)) {
					throw new Error(`dependent facts rejected ${ctx.method}`);
				}
			},
		},
		afterChange: async ({ data, operation, collections }) => {
			if (operation !== "update") return;
			await collections.guardEffects.create({
				recordId: data.id,
				name: data.name,
			});
		},
	});

const composedGuardedRecords = collection("composed_guarded_records")
	.fields(({ f }) => ({
		name: f.text().required(),
		firstTarget: f.relation("factTargets").required(),
		secondTarget: f.relation("factTargets").required(),
	}))
	.hooks({
		beforeWrite: {
			locks: ({ data, method }) => {
				composedGuardPhases.push("locks:first");
				return method === "updateBatch" || !("firstTarget" in data)
					? []
					: [{ collection: "factTargets", ids: [data.firstTarget] }];
			},
			run: () => {
				composedGuardPhases.push("run:first");
			},
		},
	})
	.hooks({
		beforeWrite: {
			locks: ({ data, method }) => {
				composedGuardPhases.push("locks:second");
				return method === "updateBatch" || !("secondTarget" in data)
					? []
					: [{ collection: "factTargets", ids: [data.secondTarget] }];
			},
			run: () => {
				composedGuardPhases.push("run:second");
			},
		},
	});

describe("transactional dependent-row fact guards", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const context = createTestContext();

	beforeEach(async () => {
		observedWrites.length = 0;
		rejectedMethods.clear();
		beforeChangeNames.length = 0;
		observedDependentRows.length = 0;
		observedLogicalPayloads.length = 0;
		composedGuardPhases.length = 0;
		setup = await buildMockApp({
			collections: {
				factTargets,
				guardEffects,
				guardedRecords,
				composedGuardedRecords,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("runs create fact guards in the exact write transaction and rolls rejection back", async () => {
		const created = await setup.app.collections.guardedRecords.create(
			{ name: "Accepted" },
			context,
		);

		expect(created.name).toBe("Accepted");
		expect(observedWrites).toEqual([
			{
				method: "create",
				operation: "create",
				original: undefined,
				exactTransaction: true,
			},
		]);
		await expect(
			setup.app.collections.guardedRecords.create({ name: "Reject" }, context),
		).rejects.toThrow("dependent facts rejected");
		expect(
			await setup.app.collections.guardedRecords.count(
				{ where: { name: "Reject" } },
				context,
			),
		).toBe(0);
	});

	it("collects every composed guard lock before any guard runs", async () => {
		const first = await setup.app.collections.factTargets.create(
			{ name: "First", status: "active" },
			context,
		);
		const second = await setup.app.collections.factTargets.create(
			{ name: "Second", status: "active" },
			context,
		);

		await setup.app.collections.composedGuardedRecords.create(
			{
				name: "Composed",
				firstTarget: first.id,
				secondTarget: second.id,
			},
			context,
		);

		expect(composedGuardPhases).toEqual([
			"locks:first",
			"locks:second",
			"run:first",
			"run:second",
		]);
	});

	it("runs update guards after the fresh canonical revision claim and before DML", async () => {
		const created = await setup.app.collections.guardedRecords.create(
			{ name: "Original", localizedName: "Localized original" },
			context,
		);
		observedWrites.length = 0;

		await expect(
			setup.app.collections.guardedRecords.updateById(
				{
					id: created.id,
					expectedRevision: created.revision,
					data: { name: "Reject" },
				},
				context,
			),
		).rejects.toThrow("dependent facts rejected");

		expect(observedWrites).toEqual([
			expect.objectContaining({
				method: "updateById",
				operation: "update",
				original: expect.objectContaining({
					id: created.id,
					name: "Original",
					localizedName: "Localized original",
					nameUpper: "ORIGINAL",
					_title: "Localized original",
					revision: created.revision,
				}),
				exactTransaction: true,
			}),
		]);
		expect(
			await setup.app.collections.guardedRecords.findOne(
				{ where: { id: created.id } },
				context,
			),
		).toMatchObject({ name: "Original", revision: created.revision });
	});

	it("returns canonical localized and virtual dependent facts after the lock", async () => {
		const target = await setup.app.collections.factTargets.create(
			{
				name: "Canonical target",
				localizedName: "Localized target",
				status: "active",
			},
			context,
		);
		await setup.app.collections.guardedRecords.create(
			{ name: "Guarded", target: target.id },
			context,
		);

		expect(observedDependentRows).toEqual([
			expect.objectContaining({
				id: target.id,
				localizedName: "Localized target",
				statusUpper: "ACTIVE",
				_title: "Localized target",
			}),
		]);
	});

	it("keeps polymorphic hook payloads logical across create, update, and updateBatch", async () => {
		const firstTarget = await setup.app.collections.factTargets.create(
			{ name: "First morph", status: "active" },
			context,
		);
		const secondTarget = await setup.app.collections.factTargets.create(
			{ name: "Second morph", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{
				name: "First subject",
				subject: { type: "factTarget", id: firstTarget.id },
			},
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{
				name: "Second subject",
				subject: { type: "factTarget", id: firstTarget.id },
			},
			context,
		);
		expect(observedLogicalPayloads.at(-1)).toEqual(
			expect.objectContaining({
				subject: { type: "factTarget", id: firstTarget.id },
			}),
		);
		expect(observedLogicalPayloads.at(-1)).not.toHaveProperty("subjectType");
		expect(observedLogicalPayloads.at(-1)).not.toHaveProperty("subjectId");

		observedLogicalPayloads.length = 0;
		const updated = await setup.app.collections.guardedRecords.updateById(
			{
				id: first.id,
				expectedRevision: first.revision,
				data: { subject: { type: "factTarget", id: secondTarget.id } },
			},
			context,
		);
		expect(updated.subject).toEqual({
			type: "factTarget",
			id: secondTarget.id,
		});
		expect(observedLogicalPayloads).toEqual([
			expect.objectContaining({
				subject: { type: "factTarget", id: secondTarget.id },
			}),
		]);
		expect(observedLogicalPayloads[0]).not.toHaveProperty("subjectType");
		expect(observedLogicalPayloads[0]).not.toHaveProperty("subjectId");

		observedLogicalPayloads.length = 0;
		await setup.app.collections.guardedRecords.updateBatch(
			{
				updates: [
					{
						id: first.id,
						expectedRevision: updated.revision,
						data: { subject: { type: "factTarget", id: firstTarget.id } },
					},
					{
						id: second.id,
						expectedRevision: second.revision,
						data: { subject: { type: "factTarget", id: secondTarget.id } },
					},
				],
			},
			context,
		);
		expect(observedLogicalPayloads).toEqual([
			[
				expect.objectContaining({
					id: first.id,
					data: {
						subject: { type: "factTarget", id: firstTarget.id },
					},
				}),
				expect.objectContaining({
					id: second.id,
					data: {
						subject: { type: "factTarget", id: secondTarget.id },
					},
				}),
			],
		]);
		for (const entry of observedLogicalPayloads[0] as Array<{
			data: Record<string, unknown>;
		}>) {
			expect(entry.data).not.toHaveProperty("subjectType");
			expect(entry.data).not.toHaveProperty("subjectId");
		}
	});

	it("guards delete and restore against their fresh locked preimages", async () => {
		const created = await setup.app.collections.guardedRecords.create(
			{ name: "Lifecycle", localizedName: "Localized lifecycle" },
			context,
		);
		observedWrites.length = 0;
		rejectedMethods.add("deleteById");

		await expect(
			setup.app.collections.guardedRecords.deleteById(
				{ id: created.id, expectedRevision: created.revision },
				context,
			),
		).rejects.toThrow("dependent facts rejected deleteById");
		expect(
			await setup.app.collections.guardedRecords.findOne(
				{ where: { id: created.id } },
				context,
			),
		).toMatchObject({ name: "Lifecycle", revision: created.revision });

		rejectedMethods.clear();
		await setup.app.collections.guardedRecords.deleteById(
			{ id: created.id, expectedRevision: created.revision },
			context,
		);
		rejectedMethods.add("restoreById");
		await expect(
			setup.app.collections.guardedRecords.restoreById(
				{ id: created.id, expectedRevision: created.revision + 1 },
				context,
			),
		).rejects.toThrow("dependent facts rejected restoreById");

		const lifecycleWrites = observedWrites.map(({ method, operation }) => ({
			method,
			operation,
		}));
		expect(lifecycleWrites).toEqual([
			{ method: "deleteById", operation: "delete" },
			{ method: "deleteById", operation: "delete" },
			{ method: "restoreById", operation: "restore" },
		]);
		for (const write of observedWrites) {
			expect(write.originals?.[0]).toMatchObject({
				localizedName: "Localized lifecycle",
				nameUpper: "LIFECYCLE",
				_title: "Localized lifecycle",
			});
		}
		expect(
			await setup.app.collections.guardedRecords.findOne(
				{ where: { id: created.id }, includeDeleted: true },
				context,
			),
		).toMatchObject({
			deletedAt: expect.any(Date),
			revision: created.revision + 1,
		});
	});

	it("rejects an archive-first bulk write without changing any primary row", async () => {
		const target = await setup.app.collections.factTargets.create(
			{ name: "Target", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{ name: "First", target: target.id },
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{ name: "Second", target: target.id },
			context,
		);
		await setup.app.collections.factTargets.updateById(
			{ id: target.id, data: { status: "archived" } },
			context,
		);

		await expect(
			setup.app.collections.guardedRecords.updateMany(
				{
					where: { id: { in: [first.id, second.id] } },
					expectedRevisions: [
						{ id: first.id, expectedRevision: first.revision },
						{ id: second.id, expectedRevision: second.revision },
					],
					data: { name: "Changed" },
				},
				context,
			),
		).rejects.toThrow("dependent target inactive");

		const { docs } = await setup.app.collections.guardedRecords.find(
			{
				where: { id: { in: [first.id, second.id] } },
				orderBy: { name: "asc" },
			},
			context,
		);
		expect(docs.map(({ name, revision }) => ({ name, revision }))).toEqual([
			{ name: "First", revision: first.revision },
			{ name: "Second", revision: second.revision },
		]);
	});

	it("rolls back earlier updateBatch rows when a later dependent fact rejects", async () => {
		const activeTarget = await setup.app.collections.factTargets.create(
			{ name: "Active", status: "active" },
			context,
		);
		const archivedTarget = await setup.app.collections.factTargets.create(
			{ name: "Archived", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{ name: "Batch first", target: activeTarget.id },
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{ name: "Batch second", target: archivedTarget.id },
			context,
		);
		await setup.app.collections.factTargets.updateById(
			{ id: archivedTarget.id, data: { status: "archived" } },
			context,
		);
		observedWrites.length = 0;

		await expect(
			setup.app.collections.guardedRecords.updateBatch(
				{
					updates: [
						{
							id: first.id,
							expectedRevision: first.revision,
							data: { name: "Batch first changed" },
						},
						{
							id: second.id,
							expectedRevision: second.revision,
							data: { name: "Batch second changed" },
						},
					],
				},
				context,
			),
		).rejects.toThrow("dependent target inactive");
		expect(observedWrites).toEqual([
			expect.objectContaining({
				method: "updateBatch",
				operation: "update",
				batchEntryNames: ["Batch first changed", "Batch second changed"],
				count: 2,
				exactTransaction: true,
			}),
		]);
		expect(beforeChangeNames).toEqual([
			"Batch first changed",
			"Batch second changed",
		]);

		const { docs } = await setup.app.collections.guardedRecords.find(
			{
				where: { id: { in: [first.id, second.id] } },
				orderBy: { name: "asc" },
			},
			context,
		);
		expect(docs.map(({ name, revision }) => ({ name, revision }))).toEqual([
			{ name: "Batch first", revision: first.revision },
			{ name: "Batch second", revision: second.revision },
		]);
		expect(await setup.app.collections.guardEffects.count({}, context)).toBe(0);
	});

	it("continues successful batch DML and effects only after the one batch-wide guard", async () => {
		const target = await setup.app.collections.factTargets.create(
			{ name: "Batch target", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{ name: "Before first", target: target.id },
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{ name: "Before second", target: target.id },
			context,
		);
		observedWrites.length = 0;
		beforeChangeNames.length = 0;

		const updated = await setup.app.collections.guardedRecords.updateBatch(
			{
				updates: [
					{
						id: first.id,
						expectedRevision: first.revision,
						data: { name: "After first" },
					},
					{
						id: second.id,
						expectedRevision: second.revision,
						data: { name: "After second" },
					},
				],
			},
			context,
		);

		expect(updated.map(({ name }) => name)).toEqual([
			"After first",
			"After second",
		]);
		expect(beforeChangeNames).toEqual(["After first", "After second"]);
		expect(observedWrites).toEqual([
			expect.objectContaining({
				method: "updateBatch",
				batchEntryNames: ["After first", "After second"],
				count: 2,
			}),
		]);
		expect(await setup.app.collections.guardEffects.count({}, context)).toBe(2);
	});

	it("rejects a batch move to a newly inactive target before any DML or effects", async () => {
		const activeTarget = await setup.app.collections.factTargets.create(
			{ name: "Current active", status: "active" },
			context,
		);
		const inactiveTarget = await setup.app.collections.factTargets.create(
			{ name: "New inactive", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{ name: "Move first", target: activeTarget.id },
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{ name: "Move second", target: activeTarget.id },
			context,
		);
		await setup.app.collections.factTargets.updateById(
			{ id: inactiveTarget.id, data: { status: "archived" } },
			context,
		);

		await expect(
			setup.app.collections.guardedRecords.updateBatch(
				{
					updates: [
						{
							id: first.id,
							expectedRevision: first.revision,
							data: { name: "Moved first" },
						},
						{
							id: second.id,
							expectedRevision: second.revision,
							data: { target: inactiveTarget.id },
						},
					],
				},
				context,
			),
		).rejects.toThrow("dependent target inactive");

		const { docs } = await setup.app.collections.guardedRecords.find(
			{
				where: { id: { in: [first.id, second.id] } },
				orderBy: { name: "asc" },
			},
			context,
		);
		expect(docs.map(({ name, target }) => ({ name, target }))).toEqual([
			{ name: "Move first", target: activeTarget.id },
			{ name: "Move second", target: activeTarget.id },
		]);
		expect(await setup.app.collections.guardEffects.count({}, context)).toBe(0);
	});

	it("rejects deleteMany before cascade or lifecycle effects and preserves every row", async () => {
		const target = await setup.app.collections.factTargets.create(
			{ name: "Delete target", status: "active" },
			context,
		);
		const first = await setup.app.collections.guardedRecords.create(
			{ name: "Delete first", target: target.id },
			context,
		);
		const second = await setup.app.collections.guardedRecords.create(
			{ name: "Delete second", target: target.id },
			context,
		);
		await setup.app.collections.factTargets.updateById(
			{ id: target.id, data: { status: "archived" } },
			context,
		);

		await expect(
			setup.app.collections.guardedRecords.deleteMany(
				{
					where: { id: { in: [first.id, second.id] } },
					expectedRevisions: [
						{ id: first.id, expectedRevision: first.revision },
						{ id: second.id, expectedRevision: second.revision },
					],
				},
				context,
			),
		).rejects.toThrow("dependent target inactive");

		expect(
			await setup.app.collections.guardedRecords.count(
				{ where: { id: { in: [first.id, second.id] } } },
				context,
			),
		).toBe(2);
	});
});
