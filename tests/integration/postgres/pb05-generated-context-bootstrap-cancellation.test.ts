import { expect, test } from "bun:test";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SQL } from "bun";

import {
	applyCommittedMigrations,
	compileApplication,
	loadCommittedMigration,
} from "@questpie/compiler";

import { installQuestpieForTracer } from "../../support/beta12-packed-questpie";
import { beta05Ids, beta05PostgresUrl } from "./helpers/beta05-runtime";

const fixtureRoot = resolve(import.meta.dir, "../../../fixtures/collaboration");
const postgresTest = process.env.PGHOST ? test : test.skip;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: unknown;
			context: Readonly<{ companyId: string }>;
			signal?: AbortSignal;
		}>,
		use: () => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	close(): Promise<void>;
}>;

type Activity = Readonly<{
	holderAccessExclusive: boolean;
	pid: number;
	query: string;
	state: string;
	targetAccessShare: boolean;
	waitEventType: string | null;
	xactStart: string | null;
}>;

type StoppedActivity = Readonly<{
	membershipLocks: number;
	state: string;
	waitEventType: string | null;
	xactStart: Date | null;
}>;

async function eventually<Value>(
	read: () => Promise<Value | undefined>,
	timeoutMs = 10_000,
): Promise<Value> {
	const deadline = performance.now() + timeoutMs;
	do {
		const value = await read();
		if (value !== undefined) return value;
		await Bun.sleep(10);
	} while (performance.now() < deadline);
	throw new Error("timed out waiting for PostgreSQL observation");
}

function databaseUrl(name: string): string {
	const url = new URL(beta05PostgresUrl());
	url.pathname = `/${name}`;
	return url.toString();
}

postgresTest(
	"exposes retained Bun Context SQL after root cancellation and reuses the application after unlock",
	async () => {
		const originalDatabase = process.env.PGDATABASE;
		const admin = new SQL(beta05PostgresUrl());
		const name = `qp_pb05_cancel_${process.pid}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-cancel-"));
		let application: GeneratedApplication | undefined;
		let observer: SQL | undefined;
		let holder: Awaited<ReturnType<SQL["reserve"]>> | undefined;
		let lockOpen = false;
		try {
			await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
			process.env.PGDATABASE = name;
			const url = databaseUrl(name);
			observer = new SQL(url);
			const migrationRoot = join(fixtureRoot, "questpie/migrations");
			const migrationNames = (
				await readdir(migrationRoot, { withFileTypes: true })
			)
				.filter((entry) => entry.isDirectory())
				.map(({ name: migrationName }) => migrationName)
				.sort();
			const migrations = await Promise.all(
				migrationNames.map((migrationName) =>
					loadCommittedMigration(join(migrationRoot, migrationName)),
				),
			);
			const applied = await applyCommittedMigrations({
				connectionString: url,
				migrations,
			});
			expect(applied.status).toBe("applied");
			await observer`
				insert into collaboration.companies (id, name)
				values (${beta05Ids.company}, 'Acme')
			`;
			await observer`
				insert into collaboration.memberships
					(id, company_id, principal_id, role, scope_key, status)
				values
					(${beta05Ids.membership}, ${beta05Ids.company}, ${beta05Ids.principal}, 'admin', 'company', 'active')
			`;

			await cp(fixtureRoot, temporary, { recursive: true });
			const questpieEntry = await installQuestpieForTracer(temporary);
			await compileApplication({ applicationRoot: temporary });
			const nonce = `?pb05=${crypto.randomUUID()}`;
			const generatedRoot = join(temporary, ".questpie/generated");
			const internal = await import(
				`${pathToFileURL(join(generatedRoot, "internal/application.js")).href}${nonce}`
			);
			const framework = await import(
				`${pathToFileURL(questpieEntry).href}${nonce}`
			);
			application = (await internal.createApplication({
				postgres: { connectionUrl: url, directConnectionUrl: url },
				realtime: { hmacKey: new Uint8Array(32) },
				maintenance: { authorize: () => true },
			})) as GeneratedApplication;

			holder = await observer.reserve();
			await holder.unsafe("BEGIN");
			lockOpen = true;
			await holder.unsafe(
				'LOCK TABLE "collaboration"."memberships" IN ACCESS EXCLUSIVE MODE',
			);
			const [holderActivity] = await holder<{ pid: number }[]>`
				select pg_catalog.pg_backend_pid()::integer as pid
			`;
			expect(holderActivity?.pid).toBeGreaterThan(0);
			if (!holderActivity)
				throw new Error("lock holder backend is unavailable");

			const controller = new AbortController();
			let handlerCalls = 0;
			const blocked = application.execution(
				{
					principal: framework.principal.user({ id: beta05Ids.principal }),
					context: { companyId: beta05Ids.company },
					signal: controller.signal,
				},
				() => {
					handlerCalls += 1;
					return "unexpected result";
				},
			);

			const waiting = await eventually(async () => {
				const [activity] = await observer!<Activity[]>`
					select activity.pid::integer as pid,
					       activity.query,
					       activity.state,
					       activity.wait_event_type as "waitEventType",
					       activity.xact_start as "xactStart",
					       exists (
					         select 1 from pg_catalog.pg_locks as held
					         where held.pid = ${holderActivity.pid}
					           and held.relation = 'collaboration.memberships'::regclass
					           and held.mode = 'AccessExclusiveLock'
					           and held.granted
					       ) as "holderAccessExclusive",
					       exists (
					         select 1 from pg_catalog.pg_locks as target
					         where target.pid = activity.pid
					           and target.relation = 'collaboration.memberships'::regclass
					           and target.mode = 'AccessShareLock'
					           and not target.granted
					       ) as "targetAccessShare"
					from pg_catalog.pg_stat_activity as activity
					where activity.datname = ${name}
					  and activity.pid <> pg_catalog.pg_backend_pid()
					  and activity.wait_event_type = 'Lock'
					  and ${holderActivity.pid} = any (
					    pg_catalog.pg_blocking_pids(activity.pid)
					  )
				`;
				return activity;
			});
			expect(waiting.state).toBe("active");
			expect(waiting.waitEventType).toBe("Lock");
			expect(waiting.holderAccessExclusive).toBe(true);
			expect(waiting.targetAccessShare).toBe(true);
			expect(waiting.query).toContain(
				'SELECT "company_id" AS "companyId", "id" AS "id", "principal_id" AS "principalId"',
			);
			expect(waiting.query).toContain('FROM "collaboration"."memberships"');
			expect(waiting.query).not.toContain("qp_selected_");
			expect(handlerCalls).toBe(0);

			controller.abort(new Error("cancel generated ContextBootstrap"));
			await expect(blocked).rejects.toBeDefined();
			expect(handlerCalls).toBe(0);
			const [retained] = await observer<Activity[]>`
				select activity.pid::integer as pid,
				       activity.query,
				       activity.state,
				       activity.wait_event_type as "waitEventType",
				       activity.xact_start as "xactStart",
				       exists (
				         select 1 from pg_catalog.pg_locks as held
				         where held.pid = ${holderActivity.pid}
				           and held.relation = 'collaboration.memberships'::regclass
				           and held.mode = 'AccessExclusiveLock'
				           and held.granted
				       ) as "holderAccessExclusive",
				       exists (
				         select 1 from pg_catalog.pg_locks as target
				         where target.pid = activity.pid
				           and target.relation = 'collaboration.memberships'::regclass
				           and target.mode = 'AccessShareLock'
				           and not target.granted
				       ) as "targetAccessShare"
				from pg_catalog.pg_stat_activity as activity
				where activity.pid = ${waiting.pid}
			`;
			expect(retained).toMatchObject({
				holderAccessExclusive: true,
				pid: waiting.pid,
				state: "active",
				targetAccessShare: true,
				waitEventType: "Lock",
			});
			expect(retained?.xactStart).not.toBeNull();

			await holder.unsafe("ROLLBACK");
			lockOpen = false;
			await holder.release();
			holder = undefined;
			const stopped = await eventually(async () => {
				const [activity] = await observer!<StoppedActivity[]>`
					select activity.state,
					       activity.wait_event_type as "waitEventType",
					       activity.xact_start as "xactStart",
					       (
					         select count(*)::integer
					         from pg_catalog.pg_locks as locks
					         where locks.pid = activity.pid
					           and locks.relation = 'collaboration.memberships'::regclass
					       ) as "membershipLocks"
					from pg_catalog.pg_stat_activity as activity
					where activity.pid = ${waiting.pid}
				`;
				if (!activity) return { gone: true as const };
				if (
					activity.state === "idle" &&
					activity.xactStart === null &&
					activity.waitEventType === "Client" &&
					activity.membershipLocks === 0
				)
					return { gone: false as const, activity };
				return undefined;
			});
			if (!stopped.gone) {
				expect(stopped.activity).toMatchObject({
					membershipLocks: 0,
					state: "idle",
					waitEventType: "Client",
					xactStart: null,
				});
			}
			let secondHandlerCalls = 0;
			await expect(
				application.execution(
					{
						principal: framework.principal.user({ id: beta05Ids.principal }),
						context: { companyId: beta05Ids.company },
					},
					() => {
						secondHandlerCalls += 1;
						return "reused";
					},
				),
			).resolves.toBe("reused");
			expect(secondHandlerCalls).toBe(1);
		} finally {
			if (lockOpen) await holder?.unsafe("ROLLBACK").catch(() => undefined);
			await holder?.release().catch(() => undefined);
			await application?.close().catch(() => undefined);
			await observer?.close({ timeout: 0 }).catch(() => undefined);
			if (originalDatabase === undefined) delete process.env.PGDATABASE;
			else process.env.PGDATABASE = originalDatabase;
			await admin
				.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
				.catch(() => undefined);
			await admin.close({ timeout: 0 }).catch(() => undefined);
			await rm(temporary, { force: true, recursive: true });
		}
	},
	60_000,
);
