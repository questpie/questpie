import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { SQL } from "bun";

import type { GeneratedApp } from "../../../fixtures/team-support-desk/.questpie/generated/app";
import { demoIds } from "../../../fixtures/team-support-desk/src/demo-ids";
import { principal } from "../../../packages/questpie/src";
import { startTeamSlaBrowser } from "../../support/team-support-sla-browser";
import { expectPostgresMajor } from "./helpers/postgres-major";

const fixture = resolve(import.meta.dir, "../../../fixtures/team-support-desk");
const cli = resolve(import.meta.dir, "../../../packages/questpie/dist/cli.js");
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

function connectionUrl(database: string): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	url.pathname = `/${database}`;
	return url.toString();
}

function command(args: readonly string[]): string {
	const result = Bun.spawnSync(["bun", cli, ...args], {
		cwd: fixture,
		env: process.env,
		stdout: "pipe",
		stderr: "pipe",
	});
	// The deployment command projects fixed safe diagnostics, never credentials.
	expect(result.exitCode, result.stderr.toString()).toBe(0);
	return result.stdout.toString();
}

postgresTest(
	"one explicit deployment feeds the existing worker and checkpoints a bounded due-ticket batch once",
	async () => {
		const name = `qp_team_sweep_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new SQL(connectionUrl("postgres"), { max: 1 });
		const previous = {
			database: process.env.PGDATABASE,
			url: process.env.DATABASE_URL,
		};
		let owned = false;
		let database: SQL | undefined;
		let application: GeneratedApp | undefined;
		let browser: Awaited<ReturnType<typeof startTeamSlaBrowser>> | undefined;
		try {
			await admin.unsafe(`CREATE DATABASE "${name}"`);
			owned = true;
			process.env.PGDATABASE = name;
			process.env.DATABASE_URL = connectionUrl(name);
			database = new SQL(connectionUrl(name), { max: 2 });
			const [connected] =
				await database`SELECT current_database() AS name, current_setting('server_version_num')::integer AS version`;
			expect(connected.name).toBe(name);
			expectPostgresMajor(connected.version);
			command(["build"]);
			command(["migration", "apply", "--allow-non-rolling-protocol-v9"]);
			command(["seed", "apply"]);
			expect(command(["seed", "apply"])).toContain("0 new");
			const [membership] =
				await database`SELECT id, principal_id, status FROM team_support_desk.memberships WHERE id = ${demoIds.memberships.agent}`;
			expect(membership).toMatchObject({
				principal_id: demoIds.principals.agent,
				status: "active",
			});
			const { createApp } =
				await import("../../../fixtures/team-support-desk/.questpie/generated/app");
			application = await createApp({
				postgres: {
					connectionUrl: connectionUrl(name),
					directConnectionUrl: connectionUrl(name),
				},
				realtime: { hmacKey: new Uint8Array(32).fill(67) },
				maintenance: { authorize: () => false },
			});
			const root = {
				principal: principal.user({ id: demoIds.principals.agent }),
				context: {
					organizationId: demoIds.organization,
					membershipId: demoIds.memberships.agent,
				},
			};
			const tickets = await application.execution(
				root,
				async ({ mutations }) => {
					expect(mutations.ticket.create).toBeFunction();
					const created = [];
					for (let index = 0; index < 1; index++)
						created.push(
							await mutations.ticket.create({
								teamId: demoIds.team,
								reference: `SUP-SWEEP-${index}`,
								summary: `Scheduled ticket ${index}`,
								description: "Bounded ordinary SLA sweep proof",
							}),
						);
					return created;
				},
			);
			expect(tickets).toHaveLength(1);
			const worker = application.durable.worker({
				workerId: `team-sweep-${name}`,
				claimBatch: 64,
			});
			// Startup/poll must not activate a deployment. These claims only settle
			// the ordinary follow-up Jobs accepted by the ticket creates.
			expect((await worker.poll()).producer).toMatchObject({
				status: "inactive",
				accepted: 0,
			});
			const before = await application.execution(root, ({ queries }) =>
				queries.tickets.detail({ id: tickets[0]!.id }),
			);
			expect(before?.lastSlaFollowUpAt).toBeNull();
			browser = await startTeamSlaBrowser({
				ticketId: tickets[0]!.id,
				fetch: (request) => application!.fetch(request),
			});
			expect(await browser.phase("sla-observer-ready")).toMatchObject({
				initial: "",
				rendered: "Last SLA follow-up: Not yet",
			});
			const receipt = JSON.parse(
				command(["schedule", "activate", "--expect-revision", "0"]),
			);
			expect(receipt).toMatchObject({ acceptedRevision: "1", replayed: false });
			// Owned-database clock control avoids a wall-minute sleep. Production
			// still observes PG clock and produces only through worker.poll.
			await database`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp()) - interval '1 minute'`;
			const first = await worker.poll();
			expect(first.producer).toMatchObject({ status: "active", accepted: 1 });
			expect(first.outcomes).toEqual([
				expect.objectContaining({ outcome: "succeeded" }),
			]);
			const after = await application.execution(root, async ({ queries }) =>
				Promise.all(
					tickets.map((ticket) => queries.tickets.detail({ id: ticket.id })),
				),
			);
			expect(
				after.every((ticket) => ticket?.lastSlaFollowUpAt instanceof Date),
			).toBe(true);
			expect(await browser.phase("sla-observer-updated")).toMatchObject({
				initial: "",
				value: after[0]!.lastSlaFollowUpAt!.toISOString(),
			});
			const jobs = await worker.poll();
			expect(jobs.outcomes).toHaveLength(1);
			expect(
				jobs.outcomes.every((outcome) => outcome.outcome === "succeeded"),
			).toBe(true);
			const [checkpoint] =
				await database`SELECT count(*)::integer AS count FROM questpie_internal.mutation_checkpoints WHERE state = 'completed'`;
			expect(checkpoint.count).toBe(1);
			const [tick] =
				await database`SELECT count(*)::integer AS count FROM questpie_internal.schedule_ticks`;
			expect(tick.count).toBe(1);
			// Different schedule runs cannot advance an already-future due row.
			const second = await application.execution(root, ({ jobs }) =>
				jobs.ticket.sweepSla.accept(
					{},
					{ idempotencyKey: "different-tick-control" },
				),
			);
			expect((await worker.poll()).outcomes).toEqual([
				expect.objectContaining({ runId: second.runId, outcome: "succeeded" }),
			]);
			expect((await worker.poll()).outcomes).toHaveLength(0);
			const unchanged = await application.execution(root, ({ queries }) =>
				queries.tickets.detail({ id: tickets[0]!.id }),
			);
			expect(unchanged?.lastSlaFollowUpAt).toEqual(after[0]?.lastSlaFollowUpAt);
			const old = await application.execution(root, ({ queries }) =>
				queries.tickets.detail({ id: demoIds.tickets.customerOpen }),
			);
			expect(old?.lastSlaFollowUpAt).toBeNull();
			worker.beginDrain();
		} finally {
			const cleanup = await Promise.allSettled([
				browser?.close(),
				application?.close(),
			]);
			await database?.close({ timeout: 0 });
			if (previous.database === undefined) delete process.env.PGDATABASE;
			else process.env.PGDATABASE = previous.database;
			if (previous.url === undefined) delete process.env.DATABASE_URL;
			else process.env.DATABASE_URL = previous.url;
			if (owned) await admin.unsafe(`DROP DATABASE "${name}"`);
			await admin.close({ timeout: 0 });
			expect(cleanup.every((result) => result.status === "fulfilled")).toBe(
				true,
			);
		}
	},
	120_000,
);
