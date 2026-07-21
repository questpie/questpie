import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, withTransaction } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const lockTargets = collection("lock_targets").fields(({ f }) => ({
	name: f.text().required(),
}));

const accessFilteredLockTargets = collection("access_filtered_lock_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
		visibility: f.text().required(),
	}))
	.access({
		read: ({ session }) =>
			(session?.user as { role?: string } | undefined)?.role === "admin"
				? true
				: { visibility: "public" },
	});

const deniedLockTargets = collection("denied_lock_targets")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.access({ read: false });

describe("transaction-scoped collection locks", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let context: ReturnType<typeof createTestContext>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: {
				lockTargets,
				accessFilteredLockTargets,
				deniedLockTargets,
			},
		});
		await runTestDbMigrations(setup.app);
		context = createTestContext();
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("rejects a lock request outside an active QUESTPIE transaction", async () => {
		const target = await setup.app.collections.lockTargets.create(
			{ name: "Company" },
			context,
		);

		await expect(
			setup.app.collections.lockTargets.lockMany({ ids: [target.id] }, context),
		).rejects.toThrow(/active QUESTPIE transaction/i);
	});

	it("locks only the bounded matching rows in deterministic id order", async () => {
		const first = await setup.app.collections.lockTargets.create(
			{ name: "First" },
			context,
		);
		const second = await setup.app.collections.lockTargets.create(
			{ name: "Second" },
			context,
		);

		const lockedIds = await withTransaction(setup.app.db, (tx) =>
			setup.app.collections.lockTargets.lockMany(
				{ ids: [second.id, first.id, second.id] },
				{ ...context, db: tx },
			),
		);

		expect(lockedIds).toEqual([first.id, second.id].sort());
	});

	it("rejects an oversized lock request before querying", async () => {
		const ids = Array.from({ length: 101 }, (_, index) => `target-${index}`);

		await expect(
			withTransaction(setup.app.db, (tx) =>
				setup.app.collections.lockTargets.lockMany(
					{ ids },
					{ ...context, db: tx },
				),
			),
		).rejects.toThrow(/at most 100 ids/i);
	});

	it("rejects a context that does not carry the active transaction", async () => {
		const target = await setup.app.collections.lockTargets.create(
			{ name: "Company" },
			context,
		);

		await expect(
			withTransaction(setup.app.db, () =>
				setup.app.collections.lockTargets.lockMany(
					{ ids: [target.id] },
					{ ...context, db: setup.app.db },
				),
			),
		).rejects.toThrow(/active QUESTPIE transaction/i);
	});

	it("returns immediately for an empty id set inside the active transaction", async () => {
		const lockedIds = await withTransaction(setup.app.db, (tx) =>
			setup.app.collections.lockTargets.lockMany(
				{ ids: [] },
				{ ...context, db: tx },
			),
		);

		expect(lockedIds).toEqual([]);
	});

	it("omits missing and row-inaccessible ids without an existence oracle", async () => {
		const visible =
			await setup.app.collections.accessFilteredLockTargets.create(
				{ name: "Visible", visibility: "public" },
				context,
			);
		const hidden = await setup.app.collections.accessFilteredLockTargets.create(
			{ name: "Hidden", visibility: "private" },
			context,
		);
		const userContext = createTestContext({ role: "member" });

		const lockedIds = await withTransaction(setup.app.db, (tx) =>
			setup.app.collections.accessFilteredLockTargets.lockMany(
				{ ids: [visible.id, hidden.id, "missing-id"] },
				{ ...userContext, db: tx },
			),
		);

		expect(lockedIds).toEqual([visible.id]);
	});

	it("fails consistently when collection read access is denied", async () => {
		const target = await setup.app.collections.deniedLockTargets.create(
			{ name: "Denied" },
			context,
		);
		const userContext = createTestContext({ role: "member" });

		await expect(
			withTransaction(setup.app.db, (tx) =>
				setup.app.collections.deniedLockTargets.lockMany(
					{ ids: [target.id, "missing-id"] },
					{ ...userContext, db: tx },
				),
			),
		).rejects.toThrow(/permission to lock records/i);
	});
});
