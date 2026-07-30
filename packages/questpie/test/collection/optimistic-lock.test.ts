import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

let observedOriginalVersion: number | undefined;
let onBeforeChange: (() => Promise<void>) | undefined;
let onBeforeDelete: (() => Promise<void>) | undefined;

const optimisticTags = collection("optimistic_tags")
	.fields(({ f }) => ({
		name: f.text().required(),
		localizedName: f.text().localized(),
		version: f.number().required().default(1),
		groups: f.relation("optimisticGroups").manyToMany({
			through: "optimisticTagGroups",
			sourceField: "tag",
			targetField: "group",
		}),
	}))
	.options({
		softDelete: true,
		timestamps: false,
		versioning: true,
		optimisticLock: { field: "version", required: true },
	})
	.access({ introspect: true })
	.hooks({
		beforeChange: async ({ original, operation }) => {
			if (operation === "update") {
				observedOriginalVersion = original?.version;
				await onBeforeChange?.();
			}
		},
		beforeDelete: async () => {
			await onBeforeDelete?.();
		},
	});
const optimisticGroups = collection("optimistic_groups").fields(({ f }) => ({
	name: f.text().required(),
}));
const optimisticTagGroups = collection("optimistic_tag_groups").fields(
	({ f }) => ({
		tag: f.relation("optimisticTags").required().onDelete("cascade"),
		group: f.relation("optimisticGroups").required().onDelete("cascade"),
	}),
);
const legacyTags = collection("legacy_tags")
	.fields(({ f }) => ({
		name: f.text().required(),
		version: f.number().required().default(1),
	}))
	.options({ softDelete: true });

describe("generated CRUD optimistic locking", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	const context = createTestContext();

	beforeEach(async () => {
		observedOriginalVersion = undefined;
		onBeforeChange = undefined;
		onBeforeDelete = undefined;
		setup = await buildMockApp({
			collections: {
				optimisticTags,
				optimisticGroups,
				optimisticTagGroups,
				legacyTags,
			},
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("rejects invalid lock fields when the collection is built", () => {
		const missing = collection("missing_lock_field")
			.fields(({ f }) => ({ title: f.text() }))
			.options({
				optimisticLock: { field: "version", required: true },
			});
		const localized = collection("localized_lock_field")
			.fields(({ f }) => ({ version: f.number().localized() }))
			.options({
				optimisticLock: { field: "version", required: true },
			});
		const virtual = collection("virtual_lock_field")
			.fields(({ f }) => ({ version: f.number().virtual() }))
			.options({
				optimisticLock: { field: "version", required: true },
			});
		const textVersion = collection("text_lock_field")
			.fields(({ f }) => ({ version: f.text().required() }))
			.options({
				optimisticLock: { field: "version", required: true },
			});
		const nullableVersion = collection("nullable_lock_field")
			.fields(({ f }) => ({ version: f.number() }))
			.options({
				optimisticLock: { field: "version", required: true },
			});

		expect(() => missing.build()).toThrow('field "version" does not exist');
		expect(() => localized.build()).toThrow(
			"must be a persisted, non-localized main-table field",
		);
		expect(() => virtual.build()).toThrow(
			"must be a persisted, non-localized main-table field",
		);
		expect(() => textVersion.build()).toThrow("must be numeric");
		expect(() => nullableVersion.build()).toThrow("must be non-nullable");
	});

	it("updates from the expected version and increments under the same write", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		const updated = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedVersion: 1,
				data: { name: "Infrastructure" },
			},
			context,
		);

		expect(updated.name).toBe("Infrastructure");
		expect(updated.version).toBe(2);
		expect(observedOriginalVersion).toBe(1);
	});

	it("increments when timestamps are disabled and only localized or relation data changes", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		const localized = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedVersion: 1,
				data: { localizedName: "Platforma" },
			},
			context,
		);
		expect(localized).toMatchObject({
			localizedName: "Platforma",
			version: 2,
		});

		const group = await setup.app.collections.optimisticGroups.create(
			{ name: "Core" },
			context,
		);
		const related = await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedVersion: 2,
				data: { groups: { set: [group.id] } },
			},
			context,
		);
		expect(related.version).toBe(3);
		const populated = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, with: { groups: true } },
			context,
		);
		expect(populated?.groups).toHaveLength(1);
	});

	it("requires a fresh expected version when reverting and increments monotonically", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Original" },
			context,
		);
		await setup.app.collections.optimisticTags.updateById(
			{
				id: tag.id,
				expectedVersion: 1,
				data: { name: "Current" },
			},
			context,
		);

		await expect(
			setup.app.collections.optimisticTags.revertToVersion(
				{ id: tag.id, version: 1 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		await expect(
			setup.app.collections.optimisticTags.revertToVersion(
				{ id: tag.id, version: 1, expectedVersion: 1 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const reverted = await setup.app.collections.optimisticTags.revertToVersion(
			{ id: tag.id, version: 1, expectedVersion: 2 },
			context,
		);
		expect(reverted).toMatchObject({ name: "Original", version: 3 });
	});

	it("rejects omitted and stale versions without mutating the row", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		for (const params of [
			{ id: tag.id, data: { name: "Omitted" } },
			{ id: tag.id, expectedVersion: 0, data: { name: "Stale" } },
		]) {
			await expect(
				setup.app.collections.optimisticTags.updateById(params, context),
			).rejects.toMatchObject({ code: "CONFLICT" });
		}

		const unchanged = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id } },
			context,
		);
		expect(unchanged?.name).toBe("Platform");
		expect(unchanged?.version).toBe(1);
	});

	it("allows exactly one of two barrier-controlled writers to commit", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		let waiting = 0;
		let release!: () => void;
		const bothReady = new Promise<void>((resolve) => {
			release = resolve;
		});
		onBeforeChange = async () => {
			waiting++;
			if (waiting === 2) release();
			await bothReady;
		};

		const outcomes = await Promise.allSettled([
			setup.app.collections.optimisticTags.updateById(
				{
					id: tag.id,
					expectedVersion: 1,
					data: { name: "Writer A" },
				},
				context,
			),
			setup.app.collections.optimisticTags.updateById(
				{
					id: tag.id,
					expectedVersion: 1,
					data: { name: "Writer B" },
				},
				context,
			),
		]);

		expect(
			outcomes.filter((outcome) => outcome.status === "fulfilled"),
		).toHaveLength(1);
		expect(
			outcomes.filter((outcome) => outcome.status === "rejected"),
		).toHaveLength(1);
		const rejected = outcomes.find((outcome) => outcome.status === "rejected");
		expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });

		const winner = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id } },
			context,
		);
		expect(["Writer A", "Writer B"]).toContain(winner?.name);
		expect(winner?.version).toBe(2);
	});

	it("guards soft delete and restore and advances the version for both", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);

		await setup.app.collections.optimisticTags.deleteById(
			{ id: tag.id, expectedVersion: 1 },
			context,
		);
		const deleted = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, includeDeleted: true },
			context,
		);
		expect(deleted?.deletedAt).toBeInstanceOf(Date);
		expect(deleted?.version).toBe(2);

		const restored = await setup.app.collections.optimisticTags.restoreById(
			{ id: tag.id, expectedVersion: 2 },
			context,
		);
		expect(restored.deletedAt).toBeNull();
		expect(restored.version).toBe(3);

		await expect(
			setup.app.collections.optimisticTags.restoreById(
				{ id: tag.id, expectedVersion: 2 },
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });
		const activeNoOp = await setup.app.collections.optimisticTags.restoreById(
			{ id: tag.id, expectedVersion: 3 },
			context,
		);
		expect(activeNoOp.deletedAt).toBeNull();
		expect(activeNoOp.version).toBe(3);
	});

	it("updates heterogeneous bulk versions atomically from an exact per-id list", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);
		await setup.app.collections.optimisticTags.updateById(
			{
				id: second.id,
				expectedVersion: 1,
				data: { name: "Second v2" },
			},
			context,
		);

		const updated = await setup.app.collections.optimisticTags.updateMany(
			{
				where: { id: { in: [first.id, second.id] } },
				expectedVersions: [
					{ id: first.id, expectedVersion: 1 },
					{ id: second.id, expectedVersion: 2 },
				],
				data: { name: "Bulk" },
			},
			context,
		);
		expect(updated.map(({ version }) => version).sort()).toEqual([2, 3]);

		await expect(
			setup.app.collections.optimisticTags.updateMany(
				{
					where: { id: { in: [first.id, second.id] } },
					expectedVersions: [
						{ id: first.id, expectedVersion: 2 },
						{ id: second.id, expectedVersion: 2 },
					],
					data: { name: "Stale bulk" },
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const unchanged = await setup.app.collections.optimisticTags.find(
			{
				where: { id: { in: [first.id, second.id] } },
				sort: { version: "asc" },
			},
			context,
		);
		expect(unchanged.docs.map(({ name }) => name)).toEqual(["Bulk", "Bulk"]);
		expect(unchanged.docs.map(({ version }) => version)).toEqual([2, 3]);
	});

	it("soft-deletes a bulk selection only with exact per-id versions", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);

		const result = await setup.app.collections.optimisticTags.deleteMany(
			{
				where: { id: { in: [first.id, second.id] } },
				expectedVersions: [
					{ id: first.id, expectedVersion: 1 },
					{ id: second.id, expectedVersion: 1 },
				],
			},
			context,
		);
		expect(result.count).toBe(2);

		const deleted = await setup.app.collections.optimisticTags.find(
			{
				where: { id: { in: [first.id, second.id] } },
				includeDeleted: true,
				sort: { id: "asc" },
			},
			context,
		);
		expect(
			deleted.docs.every(({ deletedAt }) => deletedAt instanceof Date),
		).toBe(true);
		expect(deleted.docs.map(({ version }) => version)).toEqual([2, 2]);
	});

	it("conflicts when every deleteMany candidate loses its write claim", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Raced" },
			context,
		);
		onBeforeDelete = async () => {
			onBeforeDelete = undefined;
			await setup.app.collections.optimisticTags.deleteById(
				{ id: tag.id, expectedVersion: 1 },
				context,
			);
		};

		await expect(
			setup.app.collections.optimisticTags.deleteMany(
				{
					where: { id: tag.id },
					expectedVersions: [{ id: tag.id, expectedVersion: 1 }],
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const deleted = await setup.app.collections.optimisticTags.findOne(
			{ where: { id: tag.id }, includeDeleted: true },
			context,
		);
		expect(deleted).toMatchObject({ version: 2 });
		expect(deleted?.deletedAt).toBeInstanceOf(Date);
	});

	it("applies updateBatch per-entry versions atomically", async () => {
		const first = await setup.app.collections.optimisticTags.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.optimisticTags.create(
			{ name: "Second" },
			context,
		);

		await expect(
			setup.app.collections.optimisticTags.updateBatch(
				{
					updates: [
						{
							id: first.id,
							expectedVersion: 1,
							data: { name: "First updated" },
						},
						{
							id: second.id,
							expectedVersion: 0,
							data: { name: "Second stale" },
						},
					],
				},
				context,
			),
		).rejects.toMatchObject({ code: "CONFLICT" });

		const unchanged = await setup.app.collections.optimisticTags.find(
			{ where: { id: { in: [first.id, second.id] } }, sort: { name: "asc" } },
			context,
		);
		expect(unchanged.docs.map(({ name }) => name)).toEqual(["First", "Second"]);
		expect(unchanged.docs.map(({ version }) => version)).toEqual([1, 1]);

		const updated = await setup.app.collections.optimisticTags.updateBatch(
			{
				updates: [
					{
						id: first.id,
						expectedVersion: 1,
						data: { name: "First updated" },
					},
					{
						id: second.id,
						expectedVersion: 1,
						data: { name: "Second updated" },
					},
				],
			},
			context,
		);
		expect(updated.map(({ version }) => version)).toEqual([2, 2]);
	});

	it("enforces the same contract through generated REST routes", async () => {
		const tag = await setup.app.collections.optimisticTags.create(
			{ name: "Platform" },
			context,
		);
		const handler = createFetchHandler(setup.app, { accessMode: "system" });
		const request = (path: string, method: string, body?: unknown) =>
			handler(
				new Request(`http://localhost/${path}`, {
					method,
					headers:
						body === undefined
							? undefined
							: { "content-type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
				}),
			);

		const schema = await request("optimisticTags/schema", "GET");
		expect(schema?.status).toBe(200);
		expect(await schema?.json()).toMatchObject({
			options: {
				optimisticLock: { field: "version", required: true },
			},
		});
		const meta = await request("optimisticTags/meta", "GET");
		expect(meta?.status).toBe(200);
		expect(await meta?.json()).toMatchObject({
			optimisticLock: { field: "version", required: true },
		});

		const omitted = await request(`optimisticTags/${tag.id}`, "PATCH", {
			data: { name: "Unsafe" },
		});
		expect(omitted?.status).toBe(409);
		expect(await omitted?.json()).toMatchObject({
			error: { code: "CONFLICT" },
		});

		const updated = await request(`optimisticTags/${tag.id}`, "PATCH", {
			data: { name: "REST" },
			expectedVersion: 1,
		});
		expect(updated?.status).toBe(200);
		expect(await updated?.json()).toMatchObject({ name: "REST", version: 2 });

		const deleted = await request(`optimisticTags/${tag.id}`, "DELETE", {
			expectedVersion: 2,
		});
		expect(deleted?.status).toBe(200);

		const restored = await request(`optimisticTags/${tag.id}/restore`, "POST", {
			expectedVersion: 3,
		});
		expect(restored?.status).toBe(200);
		expect(await restored?.json()).toMatchObject({
			deletedAt: null,
			version: 4,
		});

		const omittedRevert = await request(
			`optimisticTags/${tag.id}/revert`,
			"POST",
			{ version: 1 },
		);
		expect(omittedRevert?.status).toBe(409);
		const reverted = await request(`optimisticTags/${tag.id}/revert`, "POST", {
			version: 1,
			expectedVersion: 4,
		});
		expect(reverted?.status).toBe(200);
		expect(await reverted?.json()).toMatchObject({
			name: "Platform",
			version: 5,
		});
	});

	it("preserves last-write-wins CRUD for collections without the option", async () => {
		const tag = await setup.app.collections.legacyTags.create(
			{ name: "Legacy" },
			context,
		);
		const updated = await setup.app.collections.legacyTags.updateById(
			{ id: tag.id, data: { name: "Still supported", version: 7 } },
			context,
		);
		expect(updated).toMatchObject({ name: "Still supported", version: 7 });

		await setup.app.collections.legacyTags.deleteById({ id: tag.id }, context);
		const restored = await setup.app.collections.legacyTags.restoreById(
			{ id: tag.id },
			context,
		);
		expect(restored).toMatchObject({ name: "Still supported", version: 7 });
	});
});
