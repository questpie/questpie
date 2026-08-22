import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPostgresDatabaseDurableHeartbeat } from "../../../packages/runtime/src/durable/postgres-database-heartbeat";
import {
	durableAttemptHeartbeat,
	durableKernelMarker,
	durableRunHeartbeat,
} from "../../../packages/runtime/src/durable/postgres-statements";
import type { DurableClaim } from "../../../packages/runtime/src/durable/rows";
import {
	definePostgresStatement,
	type PostgresTransaction,
	type PostgresTransactionRunner,
} from "../../../packages/runtime/src/postgres/contract";

const postgres = process.env.PGHOST ? test : test.skip;

function postgresUrl(): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function configuration() {
	const url = postgresUrl();
	return {
		connectionUrl: url,
		directConnectionUrl: url,
		pool: {
			max: 2,
			connectTimeoutMs: 2_000,
			checkoutTimeoutMs: 2_000,
			idleTimeoutMs: 2_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 5_000,
			lockMs: 2_000,
			idleInTransactionMs: 5_000,
		},
	} as const;
}

type SeededClaim = Readonly<{
	runId: string;
	attemptId: string;
	leaseToken: string;
	leaseMilliseconds: number;
}>;

async function prepareClaim(outputPath: string): Promise<SeededClaim> {
	const helper = new URL("./helpers/beta08-durable.ts", import.meta.url).href;
	const runtimeHelper = new URL("./helpers/beta05-runtime.ts", import.meta.url)
		.href;
	const script = `
import { SQL } from "bun";
import { beta08Harness, disposeBeta08Harness } from ${JSON.stringify(helper)};
import { beta05Ids, beta05PostgresUrl } from ${JSON.stringify(runtimeHelper)};
const database = new SQL(beta05PostgresUrl());
try {
  const prepared = await beta08Harness(database);
  const callId = "pb05-durable-heartbeat-" + crypto.randomUUID();
  await prepared.app.execution(
    { principal: prepared.principal, context: { companyId: beta05Ids.company } },
    async ({ mutations }) => mutations["message.publish"](
      { channelId: beta05Ids.channel, body: "database heartbeat" },
      { callId },
    ),
  );
  const [row] = await database.unsafe(
    \`SELECT runs.run_id::text AS "runId"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration' AND intents.call_id = $1\`,
    [callId],
  );
  if (!row?.runId) throw new Error("seeded Durable run is unavailable");
  const outcome = await prepared.kernel.claim({
    runId: row.runId,
    workerId: "worker:pb05-database-heartbeat",
    leaseMilliseconds: 30_000,
    attemptDeadlineMilliseconds: 60_000,
  });
  if (outcome.status !== "claimed") throw new Error("seeded Durable claim lost");
  await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({
    runId: outcome.claim.runId,
    attemptId: outcome.claim.attemptId,
    leaseToken: outcome.claim.leaseToken,
    leaseMilliseconds: outcome.claim.leaseMilliseconds,
  }));
} finally {
  await disposeBeta08Harness();
  await database.close({ timeout: 2 });
}`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		env: process.env,
		stdout: "inherit",
		stderr: "inherit",
	});
	if ((await child.exited) !== 0)
		throw new Error("failed to prepare claimed Durable run");
	return JSON.parse(await readFile(outputPath, "utf8")) as SeededClaim;
}

type LeaseState = Readonly<{
	runLeaseExpiresAt: Date;
	attemptLeaseExpiresAt: Date;
	heartbeatAt: Date;
}>;

const inspectLease = definePostgresStatement<string, LeaseState>({
	name: "durable.heartbeat.lease.inspect",
	text: `SELECT runs.lease_expires_at,
       attempts.lease_expires_at,
       attempts.heartbeat_at
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.durable_attempts AS attempts
  ON attempts.application_name = runs.application_name
 AND attempts.attempt_id = runs.current_attempt_id
WHERE runs.application_name = 'application:collaboration'
  AND runs.run_id = $1::uuid`,
	parameterCount: 1,
	parameters: (runId) => [runId],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 3 ||
			row.some(
				(value) =>
					!(value instanceof Date) || !Number.isFinite(value.getTime()),
			)
		)
			throw new TypeError("invalid Durable lease inspection result");
		return Object.freeze({
			runLeaseExpiresAt: row[0] as Date,
			attemptLeaseExpiresAt: row[1] as Date,
			heartbeatAt: row[2] as Date,
		});
	},
});

async function leaseState(
	database: PostgresTransactionRunner,
	runId: string,
): Promise<LeaseState> {
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readOnly" },
		use: (transaction) => transaction.execute(inspectLease, runId),
	});
}

function expectSameLease(actual: LeaseState, expected: LeaseState): void {
	expect(actual.runLeaseExpiresAt.getTime()).toBe(
		expected.runLeaseExpiresAt.getTime(),
	);
	expect(actual.attemptLeaseExpiresAt.getTime()).toBe(
		expected.attemptLeaseExpiresAt.getTime(),
	);
	expect(actual.heartbeatAt.getTime()).toBe(expected.heartbeatAt.getTime());
}

postgres(
	"advances one Durable lease pair and rolls both updates back when the exact attempt statement fails",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-heartbeat-"));
		try {
			const claim = await prepareClaim(join(temporary, "claim.json"));
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			const heartbeat = createPostgresDatabaseDurableHeartbeat({
				database,
				application: "application:collaboration",
			});
			try {
				const before = await leaseState(database, claim.runId);
				expect(before.runLeaseExpiresAt.getTime()).toBe(
					before.attemptLeaseExpiresAt.getTime(),
				);
				await Bun.sleep(20);
				await expect(heartbeat(claim as DurableClaim)).resolves.toEqual({
					status: "held",
					cancellationRequested: false,
					deadlineExpired: false,
				});
				const advanced = await leaseState(database, claim.runId);
				expect(advanced.runLeaseExpiresAt.getTime()).toBe(
					advanced.attemptLeaseExpiresAt.getTime(),
				);
				expect(advanced.runLeaseExpiresAt.getTime()).toBeGreaterThan(
					before.runLeaseExpiresAt.getTime(),
				);
				expect(advanced.attemptLeaseExpiresAt.getTime()).toBeGreaterThan(
					before.attemptLeaseExpiresAt.getTime(),
				);
				expect(advanced.heartbeatAt.getTime()).toBeGreaterThan(
					before.heartbeatAt.getTime(),
				);

				const executed: unknown[] = [];
				let faultCalls = 0;
				const faulting: PostgresTransactionRunner = {
					transaction: (input) =>
						database.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									async execute(statement, value) {
										executed.push(statement);
										if (statement === durableAttemptHeartbeat) {
											faultCalls += 1;
											throw new TypeError("forced attempt heartbeat refusal");
										}
										return transaction.execute(statement, value);
									},
								} as PostgresTransaction),
						}),
				};
				await Bun.sleep(20);
				await expect(
					createPostgresDatabaseDurableHeartbeat({
						database: faulting,
						application: "application:collaboration",
					})(claim as DurableClaim),
				).rejects.toThrow("forced attempt heartbeat refusal");
				expect(executed).toEqual([
					durableKernelMarker,
					durableRunHeartbeat,
					durableAttemptHeartbeat,
				]);
				expect(faultCalls).toBe(1);
				expectSameLease(await leaseState(database, claim.runId), advanced);

				await Bun.sleep(20);
				await expect(heartbeat(claim as DurableClaim)).resolves.toMatchObject({
					status: "held",
				});
				const reused = await leaseState(database, claim.runId);
				expect(reused.runLeaseExpiresAt.getTime()).toBe(
					reused.attemptLeaseExpiresAt.getTime(),
				);
				expect(reused.runLeaseExpiresAt.getTime()).toBeGreaterThan(
					advanced.runLeaseExpiresAt.getTime(),
				);
				expect(reused.attemptLeaseExpiresAt.getTime()).toBeGreaterThan(
					advanced.attemptLeaseExpiresAt.getTime(),
				);
				expect(reused.heartbeatAt.getTime()).toBeGreaterThan(
					advanced.heartbeatAt.getTime(),
				);
			} finally {
				await database.close({ deadlineAt: Date.now() + 5_000 });
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
