import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { z } from "zod";

import { channel } from "../../src/exports/channels.js";
import { collection } from "../../src/exports/index.js";
import {
	questpieChannelEventTable,
	questpieRealtimeLogTable,
} from "../../src/server/modules/core/integrated/realtime/collection.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

type EffectKind =
	| "create"
	| "update"
	| "delete"
	| "restore"
	| "purge"
	| "hard-delete";

type EffectObservation = {
	targetId: string;
	kind: EffectKind;
	dataName: string;
	originalName?: string;
	isBatch?: boolean;
	recordIds?: (string | number)[];
	count?: number;
};

let failEffect: EffectKind | undefined;
let failOrdinaryUpdateHook = false;
let failHardDeleteEffect = false;
const mergedEffectOrder: string[] = [];
const moduleMergedEffectOrder: string[] = [];
const effectObservations: EffectObservation[] = [];

const transactionalEffectsChannel = channel(
	"transactional-effects-[targetId]",
).events({
	applied: z.object({
		targetId: z.string(),
		kind: z.enum([
			"create",
			"update",
			"delete",
			"restore",
			"purge",
			"hard-delete",
		]),
	}),
});

const transactionalEffectLogs = collection("transactional_effect_logs").fields(
	({ f }) => ({
		targetId: f.text().required(),
		kind: f.text().required(),
	}),
);

const transactionalEffectTargets = collection("transactional_effect_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.options({ softDelete: true, versioning: true })
	.access({ purge: true })
	.hooks({
		afterChange: ({ operation }) => {
			if (operation === "update" && failOrdinaryUpdateHook) {
				throw new Error("ordinary afterChange failure");
			}
		},
	})
	.transactionalEffects({
		afterChange: async ({
			channels,
			collections,
			count,
			data,
			isBatch,
			operation,
			original,
			recordIds,
		}) => {
			const kind: EffectKind =
				operation === "create"
					? "create"
					: original.deletedAt != null && data.deletedAt == null
						? "restore"
						: "update";
			await collections.transactionalEffectLogs.create({
				targetId: data.id,
				kind,
			});
			await channels.publish("transactionalEffects", {
				params: { targetId: data.id },
				event: "applied",
				data: { targetId: data.id, kind },
			});
			effectObservations.push({
				targetId: data.id,
				kind,
				dataName: data.name,
				...(operation === "update" ? { originalName: original.name } : {}),
				isBatch,
				recordIds: recordIds ? [...recordIds] : undefined,
				count,
			});
			if (failEffect === kind) {
				throw new Error(`mandatory ${kind} effect failure`);
			}
		},
		afterDelete: async ({
			channels,
			collections,
			count,
			data,
			isBatch,
			recordIds,
		}) => {
			await collections.transactionalEffectLogs.create({
				targetId: data.id,
				kind: "delete",
			});
			await channels.publish("transactionalEffects", {
				params: { targetId: data.id },
				event: "applied",
				data: { targetId: data.id, kind: "delete" },
			});
			effectObservations.push({
				targetId: data.id,
				kind: "delete",
				dataName: data.name,
				originalName: data.name,
				isBatch,
				recordIds: recordIds ? [...recordIds] : undefined,
				count,
			});
			if (failEffect === "delete") {
				throw new Error("mandatory delete effect failure");
			}
		},
		afterPurge: async ({ channels, collections, data }) => {
			await collections.transactionalEffectLogs.create({
				targetId: data.id,
				kind: "purge",
			});
			await channels.publish("transactionalEffects", {
				params: { targetId: data.id },
				event: "applied",
				data: { targetId: data.id, kind: "purge" },
			});
			effectObservations.push({
				targetId: data.id,
				kind: "purge",
				dataName: data.name,
				originalName: data.name,
			});
			if (failEffect === "purge") {
				throw new Error("mandatory purge effect failure");
			}
		},
	});

const hardDeleteEffectTargets = collection("hard_delete_effect_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.transactionalEffects({
		afterDelete: async ({ channels, collections, data }) => {
			await collections.transactionalEffectLogs.create({
				targetId: data.id,
				kind: "hard-delete",
			});
			await channels.publish("transactionalEffects", {
				params: { targetId: data.id },
				event: "applied",
				data: { targetId: data.id, kind: "hard-delete" },
			});
			effectObservations.push({
				targetId: data.id,
				kind: "hard-delete",
				dataName: data.name,
				originalName: data.name,
			});
			if (failHardDeleteEffect) {
				throw new Error("mandatory hard-delete effect failure");
			}
		},
	});

const mergedEffectTargets = collection("merged_effect_targets")
	.fields(({ f }) => ({ name: f.text().required() }))
	.transactionalEffects({
		afterChange: () => {
			mergedEffectOrder.push("first");
		},
	})
	.transactionalEffects({
		afterChange: () => {
			mergedEffectOrder.push("second");
		},
	});

const moduleMergedEffectTargets = collection("module_merged_effect_targets")
	.fields(({ f }) => ({ name: f.text().required() }))
	.transactionalEffects({
		afterChange: () => {
			moduleMergedEffectOrder.push("base");
		},
	})
	.merge(
		collection("module_merged_effect_targets").transactionalEffects({
			afterChange: () => {
				moduleMergedEffectOrder.push("extension");
			},
		}),
	);

describe("mandatory transactional collection effects", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const context = createTestContext();

	beforeAll(async () => {
		setup = await buildMockApp({
			channels: {
				transactionalEffects: transactionalEffectsChannel,
			},
			collections: {
				hardDeleteEffectTargets,
				mergedEffectTargets,
				moduleMergedEffectTargets,
				transactionalEffectLogs,
				transactionalEffectTargets,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterAll(async () => {
		await setup.cleanup();
	});

	beforeEach(() => {
		failEffect = undefined;
		failOrdinaryUpdateHook = false;
		failHardDeleteEffect = false;
		mergedEffectOrder.length = 0;
		moduleMergedEffectOrder.length = 0;
		effectObservations.length = 0;
	});

	async function findTarget(id: string) {
		return setup.app.collections.transactionalEffectTargets.findOne(
			{ where: { id }, includeDeleted: true },
			context,
		);
	}

	async function effectCount(targetId: string, kind: EffectKind) {
		return setup.app.collections.transactionalEffectLogs.count(
			{ where: { targetId, kind } },
			context,
		);
	}

	async function findHardDeleteTarget(id: string) {
		return setup.app.collections.hardDeleteEffectTargets.findOne(
			{ where: { id } },
			context,
		);
	}

	async function channelEffectRows(targetId: string, kind: EffectKind) {
		const rows = await setup.app.db.select().from(questpieChannelEventTable);
		return rows.filter((row) => {
			const payload = row.payload as
				| { targetId?: unknown; kind?: unknown }
				| undefined;
			return (
				row.channel === `transactional-effects-${targetId}` &&
				row.event === "applied" &&
				payload?.targetId === targetId &&
				payload.kind === kind
			);
		});
	}

	async function realtimeEffectCount(
		resource: string,
		operation: string,
		recordId: string | null,
	) {
		const rows = await setup.app.db.select().from(questpieRealtimeLogTable);
		return rows.filter(
			(row) =>
				row.resourceType === "collection" &&
				row.resource === resource &&
				row.operation === operation &&
				row.recordId === recordId,
		).length;
	}

	it("rolls back create, nested write, typed channel, and realtime outbox", async () => {
		const id = crypto.randomUUID();
		failEffect = "create";

		await expect(
			setup.app.collections.transactionalEffectTargets.create(
				{ id, name: "Create rollback" },
				context,
			),
		).rejects.toThrow("mandatory create effect failure");

		expect(await findTarget(id)).toBeNull();
		expect(await effectCount(id, "create")).toBe(0);
		expect(await channelEffectRows(id, "create")).toHaveLength(0);
		expect(
			await realtimeEffectCount("transactionalEffectTargets", "create", id),
		).toBe(0);
	});

	it("preserves ordinary update-hook isolation while committing the mandatory effect", async () => {
		const target =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Ordinary isolation" },
				context,
			);
		failOrdinaryUpdateHook = true;

		const updated =
			await setup.app.collections.transactionalEffectTargets.updateById(
				{ id: target.id, data: { name: "Still committed" } },
				context,
			);

		expect(updated.name).toBe("Still committed");
		expect(await effectCount(target.id, "update")).toBe(1);
		expect(await channelEffectRows(target.id, "update")).toHaveLength(1);
	});

	it("rolls back update and every transaction-joined ledger", async () => {
		const target =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Before update" },
				context,
			);
		failEffect = "update";

		await expect(
			setup.app.collections.transactionalEffectTargets.updateById(
				{ id: target.id, data: { name: "Must roll back" } },
				context,
			),
		).rejects.toThrow("mandatory update effect failure");

		expect((await findTarget(target.id))?.name).toBe("Before update");
		expect(await effectCount(target.id, "update")).toBe(0);
		expect(await channelEffectRows(target.id, "update")).toHaveLength(0);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"update",
				target.id,
			),
		).toBe(0);
	});

	it("rolls back soft delete and restore effects with their owner mutations", async () => {
		const deleteTarget =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Delete rollback" },
				context,
			);
		failEffect = "delete";

		await expect(
			setup.app.collections.transactionalEffectTargets.deleteById(
				{ id: deleteTarget.id },
				context,
			),
		).rejects.toThrow("mandatory delete effect failure");

		expect((await findTarget(deleteTarget.id))?.deletedAt).toBeNull();
		expect(await effectCount(deleteTarget.id, "delete")).toBe(0);
		expect(await channelEffectRows(deleteTarget.id, "delete")).toHaveLength(0);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"delete",
				deleteTarget.id,
			),
		).toBe(0);

		failEffect = undefined;
		const restoreTarget =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Restore rollback" },
				context,
			);
		await setup.app.collections.transactionalEffectTargets.deleteById(
			{ id: restoreTarget.id },
			context,
		);
		failEffect = "restore";

		await expect(
			setup.app.collections.transactionalEffectTargets.restoreById(
				{ id: restoreTarget.id },
				context,
			),
		).rejects.toThrow("mandatory restore effect failure");

		expect((await findTarget(restoreTarget.id))?.deletedAt).not.toBeNull();
		expect(await effectCount(restoreTarget.id, "restore")).toBe(0);
		expect(await channelEffectRows(restoreTarget.id, "restore")).toHaveLength(
			0,
		);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"update",
				restoreTarget.id,
			),
		).toBe(0);
	});

	it("rolls back physical purge and its nested collection write", async () => {
		const target =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Purge rollback" },
				context,
			);
		await setup.app.collections.transactionalEffectTargets.deleteById(
			{ id: target.id },
			context,
		);
		const realtimeBeforePurge = await realtimeEffectCount(
			"transactionalEffectTargets",
			"delete",
			target.id,
		);
		failEffect = "purge";

		await expect(
			setup.app.collections.transactionalEffectTargets.purgeById(
				{ id: target.id },
				context,
			),
		).rejects.toThrow("mandatory purge effect failure");

		expect((await findTarget(target.id))?.deletedAt).not.toBeNull();
		expect(await effectCount(target.id, "purge")).toBe(0);
		expect(await channelEffectRows(target.id, "purge")).toHaveLength(0);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"delete",
				target.id,
			),
		).toBe(realtimeBeforePurge);
	});

	it("runs once per successful nested updateBatch mutation", async () => {
		const first = await setup.app.collections.transactionalEffectTargets.create(
			{ name: "First" },
			context,
		);
		const second =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Second" },
				context,
			);

		await setup.app.collections.transactionalEffectTargets.updateBatch(
			{
				updates: [
					{ id: first.id, data: { name: "First updated" } },
					{ id: second.id, data: { name: "Second updated" } },
				],
			},
			context,
		);

		expect(await effectCount(first.id, "update")).toBe(1);
		expect(await effectCount(second.id, "update")).toBe(1);
		expect(await channelEffectRows(first.id, "update")).toHaveLength(1);
		expect(await channelEffectRows(second.id, "update")).toHaveLength(1);
		expect(
			effectObservations
				.filter(
					(observation) =>
						observation.kind === "update" &&
						[first.id, second.id].includes(observation.targetId),
				)
				.map(({ targetId, isBatch, recordIds, count }) => ({
					targetId,
					isBatch,
					recordIds,
					count,
				})),
		).toEqual([
			{
				targetId: first.id,
				isBatch: undefined,
				recordIds: undefined,
				count: undefined,
			},
			{
				targetId: second.id,
				isBatch: undefined,
				recordIds: undefined,
				count: undefined,
			},
		]);
	});

	it("runs updateMany once per winner with bulk metadata and rolls back every joined ledger", async () => {
		const batchName = `Update many ${crypto.randomUUID()}`;
		const first = await setup.app.collections.transactionalEffectTargets.create(
			{ name: batchName },
			context,
		);
		const second =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: batchName },
				context,
			);
		const realtimeBefore = await realtimeEffectCount(
			"transactionalEffectTargets",
			"bulk_update",
			null,
		);
		failEffect = "update";

		await expect(
			setup.app.collections.transactionalEffectTargets.updateMany(
				{ where: { name: batchName }, data: { name: "Must roll back" } },
				context,
			),
		).rejects.toThrow("mandatory update effect failure");

		expect((await findTarget(first.id))?.name).toBe(batchName);
		expect((await findTarget(second.id))?.name).toBe(batchName);
		expect(await effectCount(first.id, "update")).toBe(0);
		expect(await effectCount(second.id, "update")).toBe(0);
		expect(await channelEffectRows(first.id, "update")).toHaveLength(0);
		expect(await channelEffectRows(second.id, "update")).toHaveLength(0);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"bulk_update",
				null,
			),
		).toBe(realtimeBefore);

		failEffect = undefined;
		effectObservations.length = 0;
		const updated =
			await setup.app.collections.transactionalEffectTargets.updateMany(
				{ where: { name: batchName }, data: { name: "Committed many" } },
				context,
			);

		expect(updated).toHaveLength(2);
		expect(await effectCount(first.id, "update")).toBe(1);
		expect(await effectCount(second.id, "update")).toBe(1);
		expect(await channelEffectRows(first.id, "update")).toHaveLength(1);
		expect(await channelEffectRows(second.id, "update")).toHaveLength(1);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"bulk_update",
				null,
			),
		).toBe(realtimeBefore + 1);
		const observations = effectObservations.filter(
			(observation) => observation.kind === "update",
		);
		expect(observations).toHaveLength(2);
		for (const observation of observations) {
			expect(observation.isBatch).toBe(true);
			expect(observation.count).toBe(2);
			expect(new Set(observation.recordIds)).toEqual(
				new Set([first.id, second.id]),
			);
		}
	});

	it("runs deleteMany once per winner with bulk metadata and rolls back every joined ledger", async () => {
		const batchName = `Delete many ${crypto.randomUUID()}`;
		const first = await setup.app.collections.transactionalEffectTargets.create(
			{ name: batchName },
			context,
		);
		const second =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: batchName },
				context,
			);
		const realtimeBefore = await realtimeEffectCount(
			"transactionalEffectTargets",
			"bulk_delete",
			null,
		);
		failEffect = "delete";

		await expect(
			setup.app.collections.transactionalEffectTargets.deleteMany(
				{ where: { name: batchName } },
				context,
			),
		).rejects.toThrow("mandatory delete effect failure");

		expect((await findTarget(first.id))?.deletedAt).toBeNull();
		expect((await findTarget(second.id))?.deletedAt).toBeNull();
		expect(await effectCount(first.id, "delete")).toBe(0);
		expect(await effectCount(second.id, "delete")).toBe(0);
		expect(await channelEffectRows(first.id, "delete")).toHaveLength(0);
		expect(await channelEffectRows(second.id, "delete")).toHaveLength(0);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"bulk_delete",
				null,
			),
		).toBe(realtimeBefore);

		failEffect = undefined;
		effectObservations.length = 0;
		const deleted =
			await setup.app.collections.transactionalEffectTargets.deleteMany(
				{ where: { name: batchName } },
				context,
			);

		expect(deleted).toEqual({ success: true, count: 2 });
		expect((await findTarget(first.id))?.deletedAt).toBeInstanceOf(Date);
		expect((await findTarget(second.id))?.deletedAt).toBeInstanceOf(Date);
		expect(await effectCount(first.id, "delete")).toBe(1);
		expect(await effectCount(second.id, "delete")).toBe(1);
		expect(await channelEffectRows(first.id, "delete")).toHaveLength(1);
		expect(await channelEffectRows(second.id, "delete")).toHaveLength(1);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"bulk_delete",
				null,
			),
		).toBe(realtimeBefore + 1);
		const observations = effectObservations.filter(
			(observation) => observation.kind === "delete",
		);
		expect(observations).toHaveLength(2);
		for (const observation of observations) {
			expect(observation.isBatch).toBe(true);
			expect(observation.count).toBe(2);
			expect(new Set(observation.recordIds)).toEqual(
				new Set([first.id, second.id]),
			);
		}
	});

	it("covers hard delete through the public deleteById lifecycle", async () => {
		const target = await setup.app.collections.hardDeleteEffectTargets.create(
			{ name: "Hard delete" },
			context,
		);
		failHardDeleteEffect = true;

		await expect(
			setup.app.collections.hardDeleteEffectTargets.deleteById(
				{ id: target.id },
				context,
			),
		).rejects.toThrow("mandatory hard-delete effect failure");

		expect((await findHardDeleteTarget(target.id))?.name).toBe("Hard delete");
		expect(await effectCount(target.id, "hard-delete")).toBe(0);
		expect(await channelEffectRows(target.id, "hard-delete")).toHaveLength(0);
		expect(
			await realtimeEffectCount("hardDeleteEffectTargets", "delete", target.id),
		).toBe(0);

		failHardDeleteEffect = false;
		await setup.app.collections.hardDeleteEffectTargets.deleteById(
			{ id: target.id },
			context,
		);

		expect(await findHardDeleteTarget(target.id)).toBeNull();
		expect(await effectCount(target.id, "hard-delete")).toBe(1);
		const channelRows = await channelEffectRows(target.id, "hard-delete");
		expect(channelRows).toHaveLength(1);
		expect(channelRows[0]?.seq).toBe(1);
		expect(channelRows[0]?.eventId).toEndWith(":1");
		expect(
			await realtimeEffectCount("hardDeleteEffectTargets", "delete", target.id),
		).toBe(1);
	});

	it("runs afterChange for public version revert and rolls back its joined ledgers", async () => {
		const target =
			await setup.app.collections.transactionalEffectTargets.create(
				{ name: "Version original" },
				context,
			);
		await setup.app.collections.transactionalEffectTargets.updateById(
			{ id: target.id, data: { name: "Version current" } },
			context,
		);
		const versions =
			await setup.app.collections.transactionalEffectTargets.findVersions(
				{ id: target.id },
				context,
			);
		const originalVersion = versions.find(
			(version) => version.name === "Version original",
		);
		expect(originalVersion).toBeDefined();
		const effectBefore = await effectCount(target.id, "update");
		const channelBefore = (await channelEffectRows(target.id, "update")).length;
		const realtimeBefore = await realtimeEffectCount(
			"transactionalEffectTargets",
			"update",
			target.id,
		);
		failEffect = "update";

		await expect(
			setup.app.collections.transactionalEffectTargets.revertToVersion(
				{
					id: target.id,
					version: originalVersion!.versionNumber,
				},
				context,
			),
		).rejects.toThrow("mandatory update effect failure");

		expect((await findTarget(target.id))?.name).toBe("Version current");
		expect(await effectCount(target.id, "update")).toBe(effectBefore);
		expect(await channelEffectRows(target.id, "update")).toHaveLength(
			channelBefore,
		);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"update",
				target.id,
			),
		).toBe(realtimeBefore);

		failEffect = undefined;
		effectObservations.length = 0;
		const reverted =
			await setup.app.collections.transactionalEffectTargets.revertToVersion(
				{
					id: target.id,
					version: originalVersion!.versionNumber,
				},
				context,
			);

		expect(reverted.name).toBe("Version original");
		expect(await effectCount(target.id, "update")).toBe(effectBefore + 1);
		expect(await channelEffectRows(target.id, "update")).toHaveLength(
			channelBefore + 1,
		);
		expect(
			await realtimeEffectCount(
				"transactionalEffectTargets",
				"update",
				target.id,
			),
		).toBe(realtimeBefore + 1);
		expect(effectObservations).toEqual([
			expect.objectContaining({
				targetId: target.id,
				kind: "update",
				dataName: "Version original",
				originalName: "Version current",
				isBatch: undefined,
			}),
		]);
	});

	it("merges repeated declarations in registration order", async () => {
		await setup.app.collections.mergedEffectTargets.create(
			{ name: "Merged" },
			context,
		);

		expect(mergedEffectOrder).toEqual(["first", "second"]);
	});

	it("preserves effect order when collection modules merge", async () => {
		await setup.app.collections.moduleMergedEffectTargets.create(
			{ name: "Merged module" },
			context,
		);

		expect(moduleMergedEffectOrder).toEqual(["base", "extension"]);
	});
});
