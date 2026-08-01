import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import pg from "pg";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const databaseUrl = process.env.QUESTPIE_TRANSACTION_LOCK_DATABASE_URL;
const runPostgresContract = Boolean(databaseUrl);

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const waitForAttempt = () => new Promise((resolve) => setTimeout(resolve, 100));

let pauseArchive:
	| ((subject: { id: string; status: string }) => Promise<void>)
	| undefined;
let pauseLinkGuard:
	| ((subject: { id: string; status: string }) => Promise<void>)
	| undefined;
let pauseCrossGuard: (() => Promise<void>) | undefined;
let allowMemberFactRead = true;

const factSubjects = collection("postgres_fact_subjects")
	.fields(({ f }) => ({
		name: f.text().required(),
		status: f.text().required(),
		visibility: f.text().required(),
	}))
	.access({
		read: ({ session }) => {
			const role = (session?.user as { role?: string } | undefined)?.role;
			if (role === "admin") return true;
			return allowMemberFactRead ? { visibility: "public" } : false;
		},
	})
	.hooks({
		afterChange: async ({ data, operation }) => {
			if (
				operation === "update" &&
				(data.status === "archived" || data.visibility === "private")
			) {
				await pauseArchive?.(data);
			}
		},
	});

const factLinks = collection("postgres_fact_links")
	.fields(({ f }) => ({
		name: f.text().required(),
		subject: f.relation("factSubjects").required(),
	}))
	.access({ create: true, read: true })
	.hooks({
		beforeWrite: async ({ data, lockDependentRows }) => {
			if (!("subject" in data) || !data.subject) return;
			const [locked] = await lockDependentRows([
				{ collection: "factSubjects", ids: [data.subject] },
			]);
			const subject = locked?.rows[0] as
				| { id: string; status: string }
				| undefined;
			if (!subject) throw new Error("dependent subject missing");
			await pauseLinkGuard?.(subject);
			if (subject.status !== "active") {
				throw new Error("dependent subject inactive");
			}
		},
	});

const orderAlpha = collection("postgres_guard_order_alpha").fields(({ f }) => ({
	name: f.text().required(),
}));
const orderOmega = collection("postgres_guard_order_omega").fields(({ f }) => ({
	name: f.text().required(),
}));
const orderWrites = collection("postgres_guard_order_writes")
	.fields(({ f }) => ({
		name: f.text().required(),
		alphaId: f.text().required(),
		omegaId: f.text().required(),
		reverse: f.boolean().required(),
	}))
	.hooks({
		beforeWrite: async ({ data, lockDependentRows }) => {
			if (!("alphaId" in data) || !("omegaId" in data)) return;
			const requests = [
				{ collection: "orderAlpha" as const, ids: [data.alphaId] },
				{ collection: "orderOmega" as const, ids: [data.omegaId] },
			];
			await lockDependentRows(data.reverse ? requests.toReversed() : requests);
		},
	});

const crossAlpha = collection("postgres_guard_cross_alpha")
	.fields(({ f }) => ({
		name: f.text().required(),
		dependentId: f.text().required(),
	}))
	.hooks({
		beforeWrite: async ({ operation, original, lockDependentRows }) => {
			if (operation !== "update" || !original) return;
			await pauseCrossGuard?.();
			await lockDependentRows([
				{ collection: "crossOmega", ids: [original.dependentId] },
			]);
		},
	});

const crossOmega = collection("postgres_guard_cross_omega")
	.fields(({ f }) => ({
		name: f.text().required(),
		dependentId: f.text().required(),
	}))
	.hooks({
		beforeWrite: async ({ operation, original, lockDependentRows }) => {
			if (operation !== "update" || !original) return;
			await pauseCrossGuard?.();
			await lockDependentRows([
				{ collection: "crossAlpha", ids: [original.dependentId] },
			]);
		},
	});

describe.skipIf(!runPostgresContract)(
	"transactional dependent-row guards on PostgreSQL",
	() => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		const context = createTestContext();

		beforeAll(async () => {
			const pool = new pg.Pool({ connectionString: databaseUrl });
			try {
				await pool.query("create extension if not exists pg_trgm");
			} finally {
				await pool.end();
			}
			setup = await buildMockApp(
				{
					collections: {
						factSubjects,
						factLinks,
						orderAlpha,
						orderOmega,
						orderWrites,
						crossAlpha,
						crossOmega,
					},
				},
				{ db: { url: databaseUrl!, pool: { max: 10 } } },
			);
			await runTestDbMigrations(setup.app);
		});

		afterAll(async () => {
			if (!setup) return;
			await setup.app.migrations.down();
			await setup.cleanup();
		});

		beforeEach(() => {
			pauseArchive = undefined;
			pauseLinkGuard = undefined;
			pauseCrossGuard = undefined;
			allowMemberFactRead = true;
		});

		it("archive-first makes the waiting link reject without persistence", async () => {
			const subject = await setup.app.collections.factSubjects.create(
				{ name: "Archive first", status: "active", visibility: "public" },
				context,
			);
			const archiveWritten = deferred();
			const releaseArchive = deferred();
			pauseArchive = async ({ id }) => {
				if (id !== subject.id) return;
				archiveWritten.resolve();
				await releaseArchive.promise;
			};
			const archive = setup.app.collections.factSubjects.updateById(
				{ id: subject.id, data: { status: "archived" } },
				context,
			);
			await archiveWritten.promise;

			let linkSettled = false;
			const link = setup.app.collections.factLinks
				.create({ name: "Must reject", subject: subject.id }, context)
				.finally(() => {
					linkSettled = true;
				});
			await waitForAttempt();
			expect(linkSettled).toBe(false);
			releaseArchive.resolve();

			await archive;
			await expect(link).rejects.toThrow("dependent subject inactive");
			expect(
				await setup.app.collections.factLinks.count(
					{ where: { subject: subject.id } },
					context,
				),
			).toBe(0);
		});

		it("link-first commits before the waiting archive and remains historical", async () => {
			const subject = await setup.app.collections.factSubjects.create(
				{ name: "Link first", status: "active", visibility: "public" },
				context,
			);
			const linkLocked = deferred();
			const releaseLink = deferred();
			pauseLinkGuard = async ({ id }) => {
				if (id !== subject.id) return;
				linkLocked.resolve();
				await releaseLink.promise;
			};
			const link = setup.app.collections.factLinks.create(
				{ name: "Historical", subject: subject.id },
				context,
			);
			await linkLocked.promise;

			let archiveSettled = false;
			const archive = setup.app.collections.factSubjects
				.updateById({ id: subject.id, data: { status: "archived" } }, context)
				.finally(() => {
					archiveSettled = true;
				});
			await waitForAttempt();
			expect(archiveSettled).toBe(false);
			releaseLink.resolve();

			const linked = await link;
			await archive;
			expect(
				await setup.app.collections.factLinks.findOne(
					{ where: { id: linked.id } },
					context,
				),
			).toMatchObject({ subject: subject.id });
			expect(
				await setup.app.collections.factSubjects.findOne(
					{ where: { id: subject.id } },
					context,
				),
			).toMatchObject({ status: "archived" });
		});

		it("re-evaluates dependent access after a lock wait without disclosing denied versus missing", async () => {
			const subject = await setup.app.collections.factSubjects.create(
				{ name: "Visibility race", status: "active", visibility: "public" },
				context,
			);
			const visibilityWritten = deferred();
			const releaseVisibility = deferred();
			pauseArchive = async ({ id }) => {
				if (id !== subject.id) return;
				visibilityWritten.resolve();
				await releaseVisibility.promise;
			};
			const hide = setup.app.collections.factSubjects.updateById(
				{ id: subject.id, data: { visibility: "private" } },
				context,
			);
			await visibilityWritten.promise;

			const readerContext = createTestContext({ role: "member" });
			let deniedSettled = false;
			const denied = setup.app.collections.factLinks
				.create(
					{ name: "Denied after wait", subject: subject.id },
					readerContext,
				)
				.finally(() => {
					deniedSettled = true;
				});
			await waitForAttempt();
			expect(deniedSettled).toBe(false);
			allowMemberFactRead = false;
			releaseVisibility.resolve();

			await hide;
			await expect(denied).rejects.toThrow("dependent subject missing");
			await expect(
				setup.app.collections.factLinks.create(
					{ name: "Actually missing", subject: crypto.randomUUID() },
					readerContext,
				),
			).rejects.toThrow("dependent subject missing");
			expect(
				await setup.app.collections.factLinks.count(
					{
						where: { name: { in: ["Denied after wait", "Actually missing"] } },
					},
					context,
				),
			).toBe(0);
		});

		it("normalizes reversed multi-collection requests without deadlocking", async () => {
			const alpha = await setup.app.collections.orderAlpha.create(
				{ name: "Alpha" },
				context,
			);
			const omega = await setup.app.collections.orderOmega.create(
				{ name: "Omega" },
				context,
			);

			const outcomes = await Promise.race([
				Promise.all([
					setup.app.collections.orderWrites.create(
						{
							name: "Forward",
							alphaId: alpha.id,
							omegaId: omega.id,
							reverse: false,
						},
						context,
					),
					setup.app.collections.orderWrites.create(
						{
							name: "Reverse",
							alphaId: alpha.id,
							omegaId: omega.id,
							reverse: true,
						},
						context,
					),
				]),
				new Promise<never>((_, reject) =>
					setTimeout(
						() => reject(new Error("dependent row lock deadlock timeout")),
						3_000,
					),
				),
			]);

			expect(outcomes.map(({ name }) => name).sort()).toEqual([
				"Forward",
				"Reverse",
			]);
		});

		it("bounds a cyclic primary-to-dependent lock graph to one database-aborted transaction", async () => {
			const alphaSeed = await setup.app.collections.crossAlpha.create(
				{ name: "Alpha seed", dependentId: crypto.randomUUID() },
				context,
			);
			const omega = await setup.app.collections.crossOmega.create(
				{ name: "Omega", dependentId: alphaSeed.id },
				context,
			);
			const alpha = await setup.app.collections.crossAlpha.updateById(
				{ id: alphaSeed.id, data: { dependentId: omega.id } },
				context,
			);

			let arrivals = 0;
			const bothPrimaryRowsLocked = deferred();
			pauseCrossGuard = async () => {
				arrivals += 1;
				if (arrivals === 2) bothPrimaryRowsLocked.resolve();
				await bothPrimaryRowsLocked.promise;
			};

			const outcomes = await Promise.race([
				Promise.allSettled([
					setup.app.collections.crossAlpha.updateById(
						{ id: alpha.id, data: { name: "Alpha changed" } },
						context,
					),
					setup.app.collections.crossOmega.updateById(
						{ id: omega.id, data: { name: "Omega changed" } },
						context,
					),
				]),
				new Promise<never>((_, reject) =>
					setTimeout(
						() =>
							reject(new Error("cyclic primary lock graph did not resolve")),
						5_000,
					),
				),
			]);

			expect(
				outcomes.filter(({ status }) => status === "fulfilled"),
			).toHaveLength(1);
			expect(
				outcomes.filter(({ status }) => status === "rejected"),
			).toHaveLength(1);
			const currentAlpha = await setup.app.collections.crossAlpha.findOne(
				{ where: { id: alpha.id } },
				context,
			);
			const currentOmega = await setup.app.collections.crossOmega.findOne(
				{ where: { id: omega.id } },
				context,
			);
			expect(
				[currentAlpha?.name, currentOmega?.name].filter((name) =>
					name?.endsWith("changed"),
				),
			).toHaveLength(1);
		});
	},
);
