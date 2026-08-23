import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	durableClaimAttemptInsert,
	durableClaimAttemptsSupersede,
	durableClaimRunLease,
	durableClaimRunSelect,
} from "../../../packages/runtime/src/durable/postgres-claim-statements";
import { createPostgresDatabaseDurableClaim } from "../../../packages/runtime/src/durable/postgres-database-claim";
import { createPostgresDatabaseDurableHeartbeat } from "../../../packages/runtime/src/durable/postgres-database-heartbeat";
import { createPostgresDatabaseDurableInspection } from "../../../packages/runtime/src/durable/postgres-database-inspection";
import { createPostgresDatabaseDurableScheduling } from "../../../packages/runtime/src/durable/postgres-database-scheduling";
import { createPostgresDatabaseDurableTerminal } from "../../../packages/runtime/src/durable/postgres-database-terminal";
import { durableKernelMarker } from "../../../packages/runtime/src/durable/postgres-statements";
import { durableAttemptComplete } from "../../../packages/runtime/src/durable/postgres-terminal-statements";
import { linkReactionProjection } from "../../../packages/runtime/src/durable/projection";
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

type PreparedRun = Readonly<{ runIds: readonly string[]; projection: unknown }>;

async function prepareRun(outputPath: string): Promise<PreparedRun> {
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
  const runIds = [];
  for (let index = 0; index < 3; index += 1) {
    const callId = "pb05-durable-claim-" + crypto.randomUUID();
    await prepared.app.execution(
      { principal: prepared.principal, context: { companyId: beta05Ids.company } },
      async ({ mutations }) => mutations["message.publish"](
        { channelId: beta05Ids.channel, body: "database claim " + index },
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
    runIds.push(row.runId);
  }
  await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({
    runIds,
    projection: JSON.parse(prepared.reactionProjectionBytes),
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
		throw new Error("failed to prepare Durable run");
	return JSON.parse(await readFile(outputPath, "utf8")) as PreparedRun;
}

type ClaimState = Readonly<{
	state: string;
	attemptCount: number;
	currentAttemptId: string | null;
	attempts: number;
	attemptStarted: number;
	attemptOutcome: string | null;
	succeeded: number;
	resultBytes: Uint8Array | null;
}>;

const inspectClaim = definePostgresStatement<string, ClaimState>({
	name: "durable.claim.inspect",
	text: `SELECT runs.state,
       runs.attempt_count,
       runs.current_attempt_id::text,
       (SELECT count(*)::int FROM questpie_internal.durable_attempts AS attempts
        WHERE attempts.application_name = runs.application_name
          AND attempts.run_id = runs.run_id),
       (SELECT count(*)::int FROM questpie_internal.durable_run_events AS events
        WHERE events.application_name = runs.application_name
          AND events.run_id = runs.run_id
          AND events.kind = 'attemptStarted'),
       (SELECT attempts.outcome FROM questpie_internal.durable_attempts AS attempts
        WHERE attempts.application_name = runs.application_name
          AND attempts.run_id = runs.run_id
        ORDER BY attempts.attempt_number DESC LIMIT 1),
       (SELECT count(*)::int FROM questpie_internal.durable_run_events AS events
        WHERE events.application_name = runs.application_name
          AND events.run_id = runs.run_id AND events.kind = 'succeeded'),
       runs.result_bytes
FROM questpie_internal.durable_runs AS runs
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
			row?.length !== 8 ||
			typeof row[0] !== "string" ||
			typeof row[1] !== "number" ||
			(row[2] !== null && typeof row[2] !== "string") ||
			typeof row[3] !== "number" ||
			typeof row[4] !== "number" ||
			(row[5] !== null && typeof row[5] !== "string") ||
			typeof row[6] !== "number" ||
			(row[7] !== null && !(row[7] instanceof Uint8Array))
		)
			throw new TypeError("invalid Durable claim inspection result");
		return Object.freeze({
			state: row[0],
			attemptCount: row[1],
			currentAttemptId: row[2],
			attempts: row[3],
			attemptStarted: row[4],
			attemptOutcome: row[5],
			succeeded: row[6],
			resultBytes: row[7],
		});
	},
});

const lockRun = definePostgresStatement<string, void>({
	name: "durable.claim.lock",
	text: `SELECT 1
FROM questpie_internal.durable_runs
WHERE application_name = 'application:collaboration' AND run_id = $1::uuid
FOR UPDATE`,
	parameterCount: 1,
	parameters: (runId) => [runId],
	decode(result) {
		if (result.command !== "SELECT" || result.rowCount !== 1)
			throw new TypeError("failed to lock Durable run");
	},
});

const requestCancellation = definePostgresStatement<
	Readonly<{ runId: string; expireLease: boolean }>,
	void
>({
	name: "durable.claim.request-cancellation",
	text: `UPDATE questpie_internal.durable_runs
SET cancellation_requested = true,
    lease_expires_at = CASE WHEN $2 THEN transaction_timestamp() - interval '1 second'
                            ELSE lease_expires_at END
WHERE application_name = 'application:collaboration' AND run_id = $1::uuid`,
	parameterCount: 2,
	parameters: ({ runId, expireLease }) => [runId, expireLease],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount !== 1 ||
			result.rows.length !== 0
		)
			throw new TypeError("failed to request Durable cancellation");
	},
});

async function markCancelled(
	database: PostgresTransactionRunner,
	runId: string,
	expireLease: boolean,
): Promise<void> {
	await database.transaction({
		mode: { isolation: "readCommitted", access: "readWrite" },
		use: async (transaction) => {
			await transaction.execute(durableKernelMarker, undefined);
			await transaction.execute(requestCancellation, { runId, expireLease });
		},
	});
}

async function state(
	database: PostgresTransactionRunner,
	runId: string,
): Promise<ClaimState> {
	return database.transaction({
		mode: { isolation: "readCommitted", access: "readOnly" },
		use: (transaction) => transaction.execute(inspectClaim, runId),
	});
}

postgres(
	"proves static Durable scheduling, inspection, heartbeat, claim, terminal, and cancellation paths",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-claim-"));
		try {
			const prepared = await prepareRun(join(temporary, "run.json"));
			const [runId, readyCancellationRunId, runningCancellationRunId] =
				prepared.runIds;
			if (!runId || !readyCancellationRunId || !runningCancellationRunId)
				throw new TypeError("Durable PostgreSQL tracer requires three runs");
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			try {
				const reactions = linkReactionProjection(prepared.projection);
				const executableDigests = [
					...new Set(
						[...reactions.byIdentity.values()].map(
							(reaction) => reaction.contractDigest,
						),
					),
				].sort();
				const scheduling = createPostgresDatabaseDurableScheduling({
					database,
					application: "application:collaboration",
					executableDigests,
					maximumBatch: 8,
				});
				const inspection = createPostgresDatabaseDurableInspection({
					database,
					application: "application:collaboration",
				});
				const admissions = await scheduling.admit(8);
				expect(admissions.map(({ runId }) => runId)).toEqual(
					expect.arrayContaining(prepared.runIds),
				);
				expect(await inspection.inspect(runId)).toMatchObject({
					runId,
					state: "ready",
					version: 1,
				});
				expect(await inspection.events(runId)).toEqual([
					expect.objectContaining({ sequence: 1, kind: "accepted" }),
				]);
				const executed: object[] = [];
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
										if (statement === durableClaimAttemptInsert) {
											faultCalls += 1;
											throw new TypeError("forced claim attempt refusal");
										}
										return transaction.execute(statement, value);
									},
								} as PostgresTransaction),
						}),
				};
				const faulted = createPostgresDatabaseDurableClaim({
					database: faulting,
					application: "application:collaboration",
					reactions,
				});
				await expect(
					faulted({ runId, workerId: "worker:fault" }),
				).rejects.toThrow("forced claim attempt refusal");
				expect(executed).toEqual([
					durableKernelMarker,
					durableClaimRunSelect,
					durableClaimRunLease,
					durableClaimAttemptsSupersede,
					durableClaimAttemptInsert,
				]);
				expect(faultCalls).toBe(1);
				expect(await state(database, runId)).toEqual({
					state: "ready",
					attemptCount: 0,
					currentAttemptId: null,
					attempts: 0,
					attemptStarted: 0,
					attemptOutcome: null,
					succeeded: 0,
					resultBytes: null,
				});

				let release!: () => void;
				let entered!: () => void;
				const released = new Promise<void>((resolve) => (release = resolve));
				const locked = new Promise<void>((resolve) => (entered = resolve));
				const holder = database.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: async (transaction) => {
						await transaction.execute(durableKernelMarker, undefined);
						await transaction.execute(lockRun, runId);
						entered();
						await released;
					},
				});
				await locked;
				const claim = createPostgresDatabaseDurableClaim({
					database,
					application: "application:collaboration",
					reactions,
				});
				await expect(
					claim({ runId, workerId: "worker:locked" }),
				).resolves.toEqual({ status: "skipped" });
				release();
				await holder;

				const outcome = await claim({
					runId,
					workerId: "worker:success",
				});
				expect(outcome.status).toBe("claimed");
				const committed = await state(database, runId);
				expect(committed).toMatchObject({
					state: "running",
					attemptCount: 1,
					attempts: 1,
					attemptStarted: 1,
					attemptOutcome: null,
					succeeded: 0,
					resultBytes: null,
				});
				expect(committed.currentAttemptId).toBe(
					outcome.status === "claimed" ? outcome.claim.attemptId : null,
				);
				if (outcome.status !== "claimed")
					throw new TypeError("Durable terminal requires the claimed run");
				const heartbeat = createPostgresDatabaseDurableHeartbeat({
					database,
					application: "application:collaboration",
				});
				await expect(heartbeat(outcome.claim)).resolves.toEqual({
					status: "held",
					cancellationRequested: false,
					deadlineExpired: false,
				});

				let terminalFaults = 0;
				const faultingTerminal = createPostgresDatabaseDurableTerminal({
					database: {
						transaction: (input) =>
							database.transaction({
								...input,
								use: (transaction) =>
									input.use({
										...transaction,
										async execute(statement, value) {
											if (statement === durableAttemptComplete) {
												terminalFaults += 1;
												throw new TypeError("forced terminal refusal");
											}
											return transaction.execute(statement, value);
										},
									} as PostgresTransaction),
							}),
					},
					application: "application:collaboration",
				});
				await expect(
					faultingTerminal.succeed(outcome.claim, new Uint8Array([7])),
				).rejects.toThrow("forced terminal refusal");
				expect(terminalFaults).toBe(1);
				expect(await state(database, runId)).toEqual(committed);

				const terminal = createPostgresDatabaseDurableTerminal({
					database,
					application: "application:collaboration",
				});
				await expect(
					terminal.succeed(outcome.claim, new Uint8Array([7])),
				).resolves.toEqual({
					status: "applied",
					state: "succeeded",
					deadLetter: false,
				});
				expect(await state(database, runId)).toEqual({
					state: "succeeded",
					attemptCount: 1,
					currentAttemptId: null,
					attempts: 1,
					attemptStarted: 1,
					attemptOutcome: "succeeded",
					succeeded: 1,
					resultBytes: new Uint8Array([7]),
				});
				expect(await inspection.inspect(runId)).toMatchObject({
					runId,
					state: "succeeded",
					version: 3,
					resultBytes: new Uint8Array([7]),
				});
				expect(
					(await inspection.events(runId)).map(({ kind }) => kind),
				).toEqual(["accepted", "attemptStarted", "succeeded"]);

				const cancellationClaim = await claim({
					runId: runningCancellationRunId,
					workerId: "worker:cancellation",
					leaseMilliseconds: 1_000,
				});
				expect(cancellationClaim.status).toBe("claimed");
				await markCancelled(database, readyCancellationRunId, false);
				await markCancelled(database, runningCancellationRunId, true);
				const concurrentReapers = await Promise.all([
					scheduling.reapCancelled(1),
					scheduling.reapCancelled(1),
				]);
				expect(concurrentReapers).toEqual([1, 1]);
				await expect(scheduling.reapCancelled(8)).resolves.toBe(0);
				for (const cancelledRunId of [
					readyCancellationRunId,
					runningCancellationRunId,
				]) {
					expect(await inspection.inspect(cancelledRunId)).toMatchObject({
						runId: cancelledRunId,
						state: "cancelled",
						currentAttemptId: null,
					});
					const kinds = (await inspection.events(cancelledRunId)).map(
						({ kind }) => kind,
					);
					expect(kinds).toEqual(
						cancelledRunId === readyCancellationRunId
							? ["accepted", "cancelled"]
							: ["accepted", "attemptStarted", "cancelled"],
					);
				}
				expect(await state(database, readyCancellationRunId)).toMatchObject({
					state: "cancelled",
					attempts: 0,
					attemptOutcome: null,
				});
				expect(await state(database, runningCancellationRunId)).toMatchObject({
					state: "cancelled",
					attempts: 1,
					attemptOutcome: "cancelled",
				});
			} finally {
				await database.close({ deadlineAt: Date.now() + 5_000 });
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
