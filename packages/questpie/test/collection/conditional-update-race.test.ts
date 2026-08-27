/**
 * Atomic conditional writes (claim-checked updates/deletes)
 *
 * `updateMany`/`deleteMany` evaluate the caller's `where` in a pre-SELECT and
 * then mutate by id. Without a write-time claim check this is a TOCTOU race:
 * a row that stops matching between the pre-SELECT and the UPDATE would still
 * be written, and the caller would believe it "won" a conditional write
 * (claims, optimistic-version checks, state transitions).
 *
 * pglite is single-connection, so true parallel transactions cannot
 * interleave here. Instead these tests mutate rows in the exact TOCTOU
 * window — `beforeChange`/`beforeDelete` hooks run after the pre-SELECT and
 * before the row lock — via raw writes on the hook transaction, and assert
 * the semantic outcome: a row claimed in the window must NOT be
 * double-claimed, losers are reported by the return value, and afterChange /
 * versioning fire for winners only.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { and, eq } from "drizzle-orm";

import { collection } from "../../src/exports/index.js";
import { getColumn } from "../../src/server/collection/crud/shared/field-resolver.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// Mutable test handles — hooks call into these so each test can inject a
// "concurrent" write into the TOCTOU window.
let onBeforeChange: ((ctx: any) => Promise<void>) | null = null;
let onBeforeDelete: ((ctx: any) => Promise<void>) | null = null;
let afterChangeCount = 0;
let afterDeleteCount = 0;

const claims = collection("claims")
	.fields(({ f }) => ({
		title: f.text().required(),
		owner: f.text(),
		status: f.text(),
		revision: f.number(),
	}))
	.options({ timestamps: true, versioning: true })
	.hooks({
		beforeChange: async (ctx) => {
			await onBeforeChange?.(ctx);
		},
		afterChange: async () => {
			afterChangeCount++;
		},
		beforeDelete: async (ctx) => {
			await onBeforeDelete?.(ctx);
		},
		afterDelete: async () => {
			afterDeleteCount++;
		},
	});

const localized_claims = collection("localized_claims")
	.fields(({ f }) => ({
		sku: f.text(50).required(),
		name: f.text().required().localized(),
	}))
	.options({ timestamps: true })
	.hooks({
		beforeChange: async (ctx) => {
			await onBeforeChange?.(ctx);
		},
	});

describe("atomic conditional writes (claim-checked)", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let ctx: ReturnType<typeof createTestContext>;

	const claimsTable = () =>
		setup.app.collections.claims["~internalRelatedTable"];

	beforeEach(async () => {
		onBeforeChange = null;
		onBeforeDelete = null;
		afterChangeCount = 0;
		afterDeleteCount = 0;

		setup = await buildMockApp({
			collections: { claims, localized_claims },
		});
		await runTestDbMigrations(setup.app);
		ctx = createTestContext();
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("claims a row exactly once — the second conditional update returns []", async () => {
		const created = await setup.app.collections.claims.create(
			{ title: "Seat", owner: null },
			ctx,
		);

		const first = await setup.app.collections.claims.updateMany(
			{
				where: { id: created.id, owner: { isNull: true } },
				data: { owner: "user-a" },
			},
			ctx,
		);
		expect(first.length).toBe(1);
		expect(first[0].owner).toBe("user-a");

		const second = await setup.app.collections.claims.updateMany(
			{
				where: { id: created.id, owner: { isNull: true } },
				data: { owner: "user-b" },
			},
			ctx,
		);
		expect(second).toEqual([]);

		const row = await setup.app.collections.claims.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(row?.owner).toBe("user-a");
	});

	it("loses the claim when the row is stolen inside the TOCTOU window", async () => {
		const created = await setup.app.collections.claims.create(
			{ title: "Seat", owner: null },
			ctx,
		);
		afterChangeCount = 0;

		// Steal the row AFTER the pre-SELECT (which saw owner = null) and
		// BEFORE the row lock — exactly the claim-check window.
		onBeforeChange = async ({ db }) => {
			const table = claimsTable();
			await db
				.update(table)
				.set({ owner: "intruder" })
				.where(eq(getColumn(table, "id")!, created.id));
		};

		const result = await setup.app.collections.claims.updateMany(
			{
				where: { id: created.id, owner: { isNull: true } },
				data: { owner: "user-a" },
			},
			ctx,
		);

		// Lost the race: no rows written, observable via the empty array
		expect(result).toEqual([]);
		expect(afterChangeCount).toBe(0);

		const row = await setup.app.collections.claims.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(row?.owner).toBe("intruder");

		// No update version was created for the losing write
		const versions = await setup.app.collections.claims.findVersions(
			{ id: created.id },
			ctx,
		);
		expect(
			versions.filter((v: any) => v.versionOperation === "update").length,
		).toBe(0);
	});

	it("bulk conditional update mutates winners only and reports them", async () => {
		const a = await setup.app.collections.claims.create(
			{ title: "A", status: "draft" },
			ctx,
		);
		const b = await setup.app.collections.claims.create(
			{ title: "B", status: "draft" },
			ctx,
		);
		afterChangeCount = 0;

		// Steal row B in the TOCTOU window (once)
		let stolen = false;
		onBeforeChange = async ({ db }) => {
			if (stolen) return;
			stolen = true;
			const table = claimsTable();
			await db
				.update(table)
				.set({ status: "claimed" })
				.where(eq(getColumn(table, "id")!, b.id));
		};

		const result = await setup.app.collections.claims.updateMany(
			{ where: { status: "draft" }, data: { status: "review" } },
			ctx,
		);

		expect(result.length).toBe(1);
		expect(result[0].id).toBe(a.id);
		expect(result[0].status).toBe("review");
		// afterChange fired for the winner only
		expect(afterChangeCount).toBe(1);

		const rowB = await setup.app.collections.claims.findOne(
			{ where: { id: b.id } },
			ctx,
		);
		expect(rowB?.status).toBe("claimed");

		// Versioning followed the winners: B has no update snapshot
		const versionsA = await setup.app.collections.claims.findVersions(
			{ id: a.id },
			ctx,
		);
		const versionsB = await setup.app.collections.claims.findVersions(
			{ id: b.id },
			ctx,
		);
		expect(
			versionsA.filter((v: any) => v.versionOperation === "update").length,
		).toBe(1);
		expect(
			versionsB.filter((v: any) => v.versionOperation === "update").length,
		).toBe(0);
	});

	it("optimistic revision check: stale revision loses at write time", async () => {
		const created = await setup.app.collections.claims.create(
			{ title: "Doc", revision: 1 },
			ctx,
		);

		// A competing writer bumps the revision in the race window
		onBeforeChange = async ({ db }) => {
			const table = claimsTable();
			await db
				.update(table)
				.set({ revision: 2 })
				.where(eq(getColumn(table, "id")!, created.id));
		};

		const result = await setup.app.collections.claims.updateMany(
			{
				where: { id: created.id, revision: 1 },
				data: { title: "Doc v2", revision: 2 },
			},
			ctx,
		);
		expect(result).toEqual([]);

		const row = await setup.app.collections.claims.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(row?.title).toBe("Doc");
		expect(row?.revision).toBe(2);
	});

	it("updateById throws notFound when the row vanishes mid-update", async () => {
		const created = await setup.app.collections.claims.create(
			{ title: "Gone soon" },
			ctx,
		);

		onBeforeChange = async ({ db }) => {
			const table = claimsTable();
			await db.delete(table).where(eq(getColumn(table, "id")!, created.id));
		};

		await expect(
			setup.app.collections.claims.updateById(
				{ id: created.id, data: { title: "Too late" } },
				ctx,
			),
		).rejects.toThrow(/not found/i);
	});

	it("deleteById throws notFound when the row vanishes mid-delete", async () => {
		const created = await setup.app.collections.claims.create(
			{ title: "Gone soon" },
			ctx,
		);

		onBeforeDelete = async ({ db }) => {
			const table = claimsTable();
			await db.delete(table).where(eq(getColumn(table, "id")!, created.id));
		};

		await expect(
			setup.app.collections.claims.deleteById({ id: created.id }, ctx),
		).rejects.toThrow(/not found/i);
	});

	it("deleteMany deletes only rows that still match — count reports winners", async () => {
		const a = await setup.app.collections.claims.create(
			{ title: "A", status: "archived" },
			ctx,
		);
		const b = await setup.app.collections.claims.create(
			{ title: "B", status: "archived" },
			ctx,
		);
		afterDeleteCount = 0;

		// Revive row B in the TOCTOU window (once)
		let revived = false;
		onBeforeDelete = async ({ db }) => {
			if (revived) return;
			revived = true;
			const table = claimsTable();
			await db
				.update(table)
				.set({ status: "active" })
				.where(eq(getColumn(table, "id")!, b.id));
		};

		const result = await setup.app.collections.claims.deleteMany(
			{ where: { status: "archived" } },
			ctx,
		);

		expect(result.success).toBe(true);
		expect(result.count).toBe(1);
		// afterDelete fired for the winner only
		expect(afterDeleteCount).toBe(1);

		const rowA = await setup.app.collections.claims.findOne(
			{ where: { id: a.id } },
			ctx,
		);
		const rowB = await setup.app.collections.claims.findOne(
			{ where: { id: b.id } },
			ctx,
		);
		expect(rowA).toBeNull();
		expect(rowB?.status).toBe("active");
	});

	it("re-evaluates localized predicates at write time", async () => {
		const created = await setup.app.collections.localized_claims.create(
			{ sku: "sku-1", name: "Claim me" },
			ctx,
		);

		// Steal the en translation in the race window
		onBeforeChange = async ({ db }) => {
			const i18nTable =
				setup.app.collections.localized_claims["~internalI18nTable"];
			await db
				.update(i18nTable)
				.set({ name: "Stolen" })
				.where(
					and(
						eq(getColumn(i18nTable, "parentId")!, created.id),
						eq(getColumn(i18nTable, "locale")!, "en"),
					),
				);
		};

		const result = await setup.app.collections.localized_claims.updateMany(
			{
				where: { id: created.id, name: "Claim me" },
				data: { sku: "sku-claimed" },
			},
			ctx,
		);
		expect(result).toEqual([]);

		const row = await setup.app.collections.localized_claims.findOne(
			{ where: { id: created.id } },
			ctx,
		);
		expect(row?.sku).toBe("sku-1");
		expect(row?.name).toBe("Stolen");
	});

	it("exposes updateMany/deleteMany as the canonical bulk methods (update/delete are aliases)", async () => {
		const crud = setup.app.collections.claims;
		expect(typeof crud.updateMany).toBe("function");
		expect(typeof crud.deleteMany).toBe("function");
		expect(crud.update).toBe(crud.updateMany);
		expect(crud.delete).toBe(crud.deleteMany);
	});
});
