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

type PreparedRun = Readonly<{ runId: string; projection: unknown }>;

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
  const callId = "pb05-durable-claim-" + crypto.randomUUID();
  await prepared.app.execution(
    { principal: prepared.principal, context: { companyId: beta05Ids.company } },
    async ({ mutations }) => mutations["message.publish"](
      { channelId: beta05Ids.channel, body: "database claim" },
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
  await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({
    runId: row.runId,
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
	"rolls back a failed static claim, skips a locked run, then claims it through the same RuntimePostgres",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-claim-"));
		try {
			const prepared = await prepareRun(join(temporary, "run.json"));
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			try {
				const reactions = linkReactionProjection(prepared.projection);
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
					faulted({ runId: prepared.runId, workerId: "worker:fault" }),
				).rejects.toThrow("forced claim attempt refusal");
				expect(executed).toEqual([
					durableKernelMarker,
					durableClaimRunSelect,
					durableClaimRunLease,
					durableClaimAttemptsSupersede,
					durableClaimAttemptInsert,
				]);
				expect(faultCalls).toBe(1);
				expect(await state(database, prepared.runId)).toEqual({
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
						await transaction.execute(lockRun, prepared.runId);
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
					claim({ runId: prepared.runId, workerId: "worker:locked" }),
				).resolves.toEqual({ status: "skipped" });
				release();
				await holder;

				const outcome = await claim({
					runId: prepared.runId,
					workerId: "worker:success",
				});
				expect(outcome.status).toBe("claimed");
				const committed = await state(database, prepared.runId);
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
				expect(await state(database, prepared.runId)).toEqual(committed);

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
				expect(await state(database, prepared.runId)).toEqual({
					state: "succeeded",
					attemptCount: 1,
					currentAttemptId: null,
					attempts: 1,
					attemptStarted: 1,
					attemptOutcome: "succeeded",
					succeeded: 1,
					resultBytes: new Uint8Array([7]),
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
