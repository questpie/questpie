/** THROWAWAY research fixture. Only run against a disposable PostgreSQL instance.
 * Creates and drops its own database; never imported by framework code.
 * QUESTPIE_LIVE_PROTOTYPE_DATABASE_URL=... bun packages/questpie/bench/live-projections-prototype.ts
 */
import assert from "node:assert/strict";

import pg from "pg";
import { z } from "zod";

import { collection, sql, withTransaction } from "../src/exports/index.js";
import { route } from "../src/server/routes/define-route.js";
import { executeJsonRoute } from "../src/server/routes/execute.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import {
	createMockSession,
	createTestContext,
} from "../test/utils/test-context.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

const source = process.env.QUESTPIE_LIVE_PROTOTYPE_DATABASE_URL;
if (!source) throw new Error("Supply the disposable PostgreSQL URL explicitly");
const database = `prototype_live_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: source });
const target = new URL(source);
target.pathname = `/${database}`;
let cleanup: (() => Promise<void>) | undefined;
const report: Record<string, unknown> = {
	question:
		"Can existing v3 route execution host consistent projections and atomic output validation?",
	database,
};

try {
	await admin.query(`CREATE DATABASE "${database}"`);
	const provision = new pg.Pool({ connectionString: target.toString() });
	await provision.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	await provision.end();
	const model = (name: string) =>
		collection(name)
			.fields(({ f }) => ({
				tenant: f.text(50).required(),
				revision: f.number().required(),
			}))
			.access({
				read: ({ session }) => (session ? { tenant: session.user.id } : false),
				create: false,
				update: false,
				delete: false,
			});
	const setup = await buildMockApp(
		{
			collections: {
				protoTasks: model("protoTasks"),
				protoRuns: model("protoRuns"),
			},
		},
		{ db: { url: target.toString() }, realtime: { enabled: false } },
	);
	cleanup = setup.cleanup;
	const app = setup.app;
	await runTestDbMigrations(app);
	const system = createTestContext({ accessMode: "system" });
	const user = createTestContext({
		accessMode: "user",
		session: createMockSession({ id: "alpha" }),
	});
	const ids: Record<string, { task: string; run: string }> = {};
	for (const tenant of ["alpha", "beta"]) {
		const task = await app.collections.protoTasks.create(
			{ tenant, revision: 0 },
			system,
		);
		const run = await app.collections.protoRuns.create(
			{ tenant, revision: 0 },
			system,
		);
		ids[tenant] = { task: task.id, run: run.id };
	}
	async function writeBoth(revision: number) {
		return withTransaction(app.db, async (db) => {
			await app.collections.protoTasks.updateById(
				{ id: ids.alpha!.task, data: { revision } },
				{ ...system, db },
			);
			await app.collections.protoRuns.updateById(
				{ id: ids.alpha!.run, data: { revision } },
				{ ...system, db },
			);
		});
	}
	let betweenReads: (() => Promise<void>) | undefined;
	const read = route()
		.post()
		.access(true)
		.schema(z.object({}))
		.outputSchema(
			z.object({
				task: z.number(),
				run: z.number(),
				tenants: z.array(z.string()),
			}),
		)
		.handler(async ({ collections }) => {
			const task = await collections.protoTasks.findOne({});
			await betweenReads?.();
			const runs = await collections.protoRuns.find({ limit: 10 });
			return {
				task: task!.revision,
				run: runs.docs[0]!.revision,
				tenants: runs.docs.map((r: { tenant: string }) => r.tenant),
			};
		});
	async function readWithConcurrentCommit(consistent: boolean) {
		await writeBoth(0);
		const firstRead = Promise.withResolvers<void>();
		const proceed = Promise.withResolvers<void>();
		betweenReads = async () => {
			firstRead.resolve();
			await proceed.promise;
		};
		const reading = consistent
			? withTransaction(app.db, async (db) => {
					await db.execute(
						sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
					);
					return executeJsonRoute(app, read, {}, { ...user, db });
				})
			: executeJsonRoute(app, read, {}, user);
		await firstRead.promise;
		await writeBoth(1);
		proceed.resolve();
		const result = await reading;
		betweenReads = undefined;
		return result;
	}
	report.ordinaryRoute = await readWithConcurrentCommit(false);
	report.snapshotRoute = await readWithConcurrentCommit(true);
	assert.deepEqual(report.ordinaryRoute, {
		task: 0,
		run: 1,
		tenants: ["alpha"],
	});
	assert.deepEqual(report.snapshotRoute, {
		task: 0,
		run: 0,
		tenants: ["alpha"],
	});

	const invalidCommand = route()
		.post()
		.access(true)
		.schema(z.object({}))
		.outputSchema(z.object({ revision: z.number().min(1) }))
		.handler(async ({ collections }) => {
			await collections.protoTasks.updateById({
				id: ids.alpha!.task,
				data: { revision: 1 },
			});
			await collections.protoRuns.updateById({
				id: ids.alpha!.run,
				data: { revision: 1 },
			});
			return { revision: 0 }; // Deliberately violates the declared result after writes.
		});
	await writeBoth(0);
	await assert.rejects(executeJsonRoute(app, invalidCommand, {}, system));
	report.afterOrdinaryInvalidOutput = await executeJsonRoute(
		app,
		read,
		{},
		user,
	);
	await writeBoth(0);
	await assert.rejects(
		withTransaction(app.db, (db) =>
			executeJsonRoute(app, invalidCommand, {}, { ...system, db }),
		),
	);
	report.afterTransactionalInvalidOutput = await executeJsonRoute(
		app,
		read,
		{},
		user,
	);
	assert.deepEqual(report.afterOrdinaryInvalidOutput, {
		task: 1,
		run: 1,
		tenants: ["alpha"],
	});
	assert.deepEqual(report.afterTransactionalInvalidOutput, {
		task: 0,
		run: 0,
		tenants: ["alpha"],
	});
	report.verdict =
		"Existing executor can be wrapped, but ordinary routes promise neither a multi-read snapshot nor output-validation rollback. User-mode collection ACL remains effective inside the wrapper.";
	console.log(JSON.stringify(report, null, 2));
} finally {
	await cleanup?.();
	await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
	await admin.end();
}
