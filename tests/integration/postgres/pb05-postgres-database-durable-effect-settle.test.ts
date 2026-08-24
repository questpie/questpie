import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SQL } from "bun";

import { createPostgresDatabaseDurableEffectAmbiguous } from "../../../packages/runtime/src/durable/postgres-database-effect-ambiguous";
import { createPostgresDatabaseDurableEffectRead } from "../../../packages/runtime/src/durable/postgres-database-effect-read";
import { createPostgresDatabaseDurableEffectReserve } from "../../../packages/runtime/src/durable/postgres-database-effect-reserve";
import { createPostgresDatabaseDurableEffectSettle } from "../../../packages/runtime/src/durable/postgres-database-effect-settle";
import {
	durableEffectAmbiguous,
	durableEffectFence,
	durableEffectReservationRead,
	durableEventInsert,
	durableKernelMarker,
} from "../../../packages/runtime/src/durable/postgres-statements";
import {
	leaseTokenDigest,
	type DurableClaim,
} from "../../../packages/runtime/src/durable/rows";
import {
	definePostgresStatement,
	type PostgresTransaction,
	type PostgresTransactionRunner,
} from "../../../packages/runtime/src/postgres/contract";

const postgres = process.env.PGHOST ? test : test.skip;
const application = "application:collaboration";

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

type Seed = Readonly<{
	claim: Readonly<{
		runId: string;
		dispatchId: string;
		resource: string;
		attemptId: string;
		leaseToken: string;
		causationId: string;
		correlationId: string;
	}>;
	effectName: string;
	effectInput: Readonly<{ messageId: string }>;
}>;

async function prepareSeed(outputPath: string): Promise<Seed> {
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
  const callId = "pb05-effect-fence-" + crypto.randomUUID();
  const message = await prepared.app.execution(
    { principal: prepared.principal, context: { companyId: beta05Ids.company } },
    ({ mutations }) => mutations.message.publish(
      { channelId: beta05Ids.channel, body: "database effect fence" },
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
    workerId: "worker:pb05-effect-fence",
    leaseMilliseconds: 30_000,
    attemptDeadlineMilliseconds: 60_000,
  });
  if (outcome.status !== "claimed") throw new Error("seeded claim lost");
  const effectName = "deliver-message";
  const reserved = await prepared.ledger.reserve(outcome.claim, {
    effectName,
    input: { messageId: message.id },
  });
  if (reserved.status !== "reserved") throw new Error("effect was not reserved");
  await Bun.write(${JSON.stringify(outputPath)}, JSON.stringify({
    claim: {
      runId: outcome.claim.runId,
      dispatchId: outcome.claim.dispatchId,
      resource: outcome.claim.resource,
      attemptId: outcome.claim.attemptId,
      leaseToken: outcome.claim.leaseToken,
      causationId: outcome.claim.causationId,
      correlationId: outcome.claim.correlationId,
    },
    effectName,
    effectInput: { messageId: message.id },
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
		throw new Error("failed to prepare Durable effect fence fixture");
	return JSON.parse(await readFile(outputPath, "utf8")) as Seed;
}

const supersedeLease = definePostgresStatement<
	Readonly<{ runId: string; digest: string }>,
	void
>({
	name: "durable.effect.test.supersede",
	text: `UPDATE questpie_internal.durable_runs
SET lease_token_digest = $2::text
WHERE application_name = 'application:collaboration' AND run_id = $1::uuid`,
	parameterCount: 2,
	parameters: (input) => [input.runId, input.digest],
	decode(result) {
		if (
			result.command !== "UPDATE" ||
			result.rowCount !== 1 ||
			result.rows.length
		)
			throw new TypeError("invalid Durable supersession result");
	},
});

const backendPid = definePostgresStatement<void, number>({
	name: "durable.effect.test.backend-pid",
	text: "SELECT pg_catalog.pg_backend_pid()",
	parameterCount: 0,
	parameters: () => [],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 1 ||
			!Number.isSafeInteger(row[0])
		)
			throw new TypeError("invalid PostgreSQL backend PID");
		return row[0] as number;
	},
});

const effectState = definePostgresStatement<
	Readonly<{ runId: string; effectName: string }>,
	Readonly<{ status: string; receipt: string | null; settledEvents: number }>
>({
	name: "durable.effect.test.inspect",
	text: `SELECT effects.status, effects.receipt,
  (SELECT count(*)::int FROM questpie_internal.durable_run_events AS events
   WHERE events.application_name = effects.application_name
     AND events.run_id = effects.run_id AND events.kind = 'effectSettled')
FROM questpie_internal.durable_effects AS effects
WHERE effects.application_name = 'application:collaboration'
  AND effects.run_id = $1::uuid AND effects.effect_name = $2::text`,
	parameterCount: 2,
	parameters: (input) => [input.runId, input.effectName],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 3 ||
			typeof row[0] !== "string" ||
			!(row[1] === null || typeof row[1] === "string") ||
			typeof row[2] !== "number"
		)
			throw new TypeError("invalid Durable effect inspection result");
		return Object.freeze({
			status: row[0],
			receipt: row[1],
			settledEvents: row[2],
		});
	},
});

const ambiguousEffectState = definePostgresStatement<
	Readonly<{ runId: string; effectName: string }>,
	Readonly<{ status: string; ambiguousEvents: number }>
>({
	name: "durable.effect.test.inspect-ambiguous",
	text: `SELECT effects.status,
  (SELECT count(*)::int FROM questpie_internal.durable_run_events AS events
   WHERE events.application_name = effects.application_name
     AND events.run_id = effects.run_id AND events.kind = 'effectAmbiguous')
FROM questpie_internal.durable_effects AS effects
WHERE effects.application_name = 'application:collaboration'
  AND effects.run_id = $1::uuid AND effects.effect_name = $2::text`,
	parameterCount: 2,
	parameters: (input) => [input.runId, input.effectName],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 2 ||
			typeof row[0] !== "string" ||
			typeof row[1] !== "number"
		)
			throw new TypeError("invalid ambiguous Durable effect inspection result");
		return Object.freeze({ status: row[0], ambiguousEvents: row[1] });
	},
});

const effectCount = definePostgresStatement<
	Readonly<{ runId: string; effectName: string }>,
	number
>({
	name: "durable.effect.test.count",
	text: `SELECT count(*)::int FROM questpie_internal.durable_effects
WHERE application_name = 'application:collaboration'
  AND run_id = $1::uuid AND effect_name = $2::text`,
	parameterCount: 2,
	parameters: (input) => [input.runId, input.effectName],
	decode(result) {
		const row = result.rows[0];
		if (
			result.command !== "SELECT" ||
			result.rowCount !== 1 ||
			result.rows.length !== 1 ||
			row?.length !== 1 ||
			!Number.isSafeInteger(row[0])
		)
			throw new TypeError("invalid Durable effect count result");
		return row[0] as number;
	},
});

postgres(
	"a committed lease supersession fences a waiting effect settlement",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-effect-"));
		try {
			const seed = await prepareSeed(join(temporary, "seed.json"));
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			const observer = new SQL(postgresUrl());
			let releaseSupersession = () => {};
			const holdSupersession = new Promise<void>((resolve) => {
				releaseSupersession = resolve;
			});
			let superseded!: () => void;
			const supersessionEntered = new Promise<void>((resolve) => {
				superseded = resolve;
			});
			let supersession: Promise<void> | undefined;
			let settlement: Promise<"applied" | "fenced"> | undefined;
			try {
				const replacementToken = "lease:pb05-effect-replacement";
				let blockerPid = 0;
				supersession = database.transaction({
					mode: { isolation: "readCommitted", access: "readWrite" },
					use: async (transaction) => {
						await transaction.execute(durableKernelMarker, undefined);
						blockerPid = await transaction.execute(backendPid, undefined);
						await transaction.execute(supersedeLease, {
							runId: seed.claim.runId,
							digest: leaseTokenDigest(replacementToken),
						});
						superseded();
						await holdSupersession;
					},
				});
				await Promise.race([
					supersessionEntered,
					supersession.then(() => {
						throw new Error("supersession ended before its hold");
					}),
					Bun.sleep(5_000).then(() => {
						throw new Error("supersession did not acquire the run row");
					}),
				]);

				let fenceEntered!: () => void;
				const atFence = new Promise<void>((resolve) => {
					fenceEntered = resolve;
				});
				let candidatePid = 0;
				const observed: PostgresTransactionRunner = {
					transaction: (input) =>
						database.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									async execute(statement, value) {
										if (statement === durableEffectFence) {
											candidatePid = await transaction.execute(
												backendPid,
												undefined,
											);
											fenceEntered();
										}
										return transaction.execute(statement, value);
									},
								} as PostgresTransaction),
						}),
				};
				settlement = createPostgresDatabaseDurableEffectSettle({
					database: observed,
					application,
				})(seed.claim as DurableClaim, {
					effectName: seed.effectName,
					receipt: "provider:must-not-commit",
				});
				await atFence;
				const lockDeadline = Date.now() + 5_000;
				let lockWitness:
					| Readonly<{ state: string; waitEventType: string; blocked: boolean }>
					| undefined;
				while (Date.now() < lockDeadline) {
					const [row] = await observer.unsafe<
						readonly Readonly<{
							state: string;
							waitEventType: string;
							blocked: boolean;
						}>[]
					>(
						`SELECT state, wait_event_type AS "waitEventType",
       $2::int = ANY(pg_catalog.pg_blocking_pids(pid)) AS blocked
FROM pg_catalog.pg_stat_activity WHERE pid = $1::int`,
						[candidatePid, blockerPid],
					);
					if (
						row?.state === "active" &&
						row.waitEventType === "Lock" &&
						row.blocked
					) {
						lockWitness = row;
						break;
					}
					await Bun.sleep(10);
				}
				expect(lockWitness).toEqual({
					state: "active",
					waitEventType: "Lock",
					blocked: true,
				});
				releaseSupersession();
				await supersession;
				await expect(settlement).resolves.toBe("fenced");

				const state = await database.transaction({
					mode: { isolation: "readCommitted", access: "readOnly" },
					use: (transaction) =>
						transaction.execute(effectState, {
							runId: seed.claim.runId,
							effectName: seed.effectName,
						}),
				});
				expect(state).toEqual({
					status: "pending",
					receipt: null,
					settledEvents: 0,
				});

				await expect(
					createPostgresDatabaseDurableEffectSettle({
						database,
						application,
					})({ ...seed.claim, leaseToken: replacementToken } as DurableClaim, {
						effectName: seed.effectName,
						receipt: "provider:replacement-winner",
					}),
				).resolves.toBe("applied");
				await expect(
					database.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: (transaction) =>
							transaction.execute(effectState, {
								runId: seed.claim.runId,
								effectName: seed.effectName,
							}),
					}),
				).resolves.toEqual({
					status: "succeeded",
					receipt: "provider:replacement-winner",
					settledEvents: 1,
				});
			} finally {
				releaseSupersession();
				await Promise.allSettled(
					[supersession, settlement].filter(
						(value): value is Promise<unknown> => value !== undefined,
					),
				);
				await observer.close({ timeout: 2 });
				await database.close({ deadlineAt: Date.now() + 5_000 });
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);

postgres(
	"an event failure rolls an ambiguous effect transition back before a reusable success",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-ambiguous-"));
		try {
			const seed = await prepareSeed(join(temporary, "seed.json"));
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			let eventFaults = 0;
			const faulting: PostgresTransactionRunner = {
				transaction: (input) =>
					database.transaction({
						...input,
						use: (transaction) =>
							input.use({
								...transaction,
								async execute(statement, value) {
									if (statement === durableEventInsert) {
										eventFaults += 1;
										throw new TypeError("forced ambiguous event failure");
									}
									return transaction.execute(statement, value);
								},
							} as PostgresTransaction),
					}),
			};
			try {
				await expect(
					createPostgresDatabaseDurableEffectAmbiguous({
						database: faulting,
						application,
					})(seed.claim as DurableClaim, { effectName: seed.effectName }),
				).rejects.toThrow("forced ambiguous event failure");
				expect(eventFaults).toBe(1);
				await expect(
					database.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: (transaction) =>
							transaction.execute(ambiguousEffectState, {
								runId: seed.claim.runId,
								effectName: seed.effectName,
							}),
					}),
				).resolves.toEqual({ status: "pending", ambiguousEvents: 0 });

				const executed: unknown[] = [];
				const observed: PostgresTransactionRunner = {
					transaction: (input) =>
						database.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									async execute(statement, value) {
										executed.push(statement);
										return transaction.execute(statement, value);
									},
								} as PostgresTransaction),
						}),
				};
				await expect(
					createPostgresDatabaseDurableEffectAmbiguous({
						database: observed,
						application,
					})(seed.claim as DurableClaim, { effectName: seed.effectName }),
				).resolves.toBe("applied");
				expect(executed).toContain(durableEffectAmbiguous);
				await expect(
					database.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: (transaction) =>
							transaction.execute(ambiguousEffectState, {
								runId: seed.claim.runId,
								effectName: seed.effectName,
							}),
					}),
				).resolves.toEqual({ status: "ambiguous", ambiguousEvents: 1 });
			} finally {
				await database.close({ deadlineAt: Date.now() + 5_000 });
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);

postgres(
	"reserves, conflicts, recovers, and rolls an incomplete reservation back",
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-pb05-reserve-"));
		try {
			const seed = await prepareSeed(join(temporary, "seed.json"));
			const { createRuntimePostgres } =
				await import("../../../packages/runtime/src/postgres");
			const database = createRuntimePostgres(configuration());
			try {
				const reserve = createPostgresDatabaseDurableEffectReserve({
					database,
					application,
				});
				const matching = await reserve(seed.claim as DurableClaim, {
					effectName: seed.effectName,
					input: seed.effectInput,
				});
				expect(matching.status).toBe("reserved");
				await expect(
					reserve(seed.claim as DurableClaim, {
						effectName: seed.effectName,
						input: { messageId: "different" },
					}),
				).resolves.toMatchObject({ status: "conflict" });

				await createPostgresDatabaseDurableEffectSettle({
					database,
					application,
				})(seed.claim as DurableClaim, {
					effectName: seed.effectName,
					receipt: "provider:recovered",
				});
				await expect(
					reserve(seed.claim as DurableClaim, {
						effectName: seed.effectName,
						input: seed.effectInput,
					}),
				).resolves.toMatchObject({
					status: "recovered",
					receipt: "provider:recovered",
				});

				const rollbackEffect = "deliver-secondary";
				let readFaults = 0;
				const faulting: PostgresTransactionRunner = {
					transaction: (input) =>
						database.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									async execute(statement, value) {
										if (statement === durableEffectReservationRead) {
											readFaults += 1;
											throw new TypeError("forced reservation read failure");
										}
										return transaction.execute(statement, value);
									},
								} as PostgresTransaction),
						}),
				};
				await expect(
					createPostgresDatabaseDurableEffectReserve({
						database: faulting,
						application,
					})(seed.claim as DurableClaim, {
						effectName: rollbackEffect,
						input: { attempt: 1 },
					}),
				).rejects.toThrow("forced reservation read failure");
				expect(readFaults).toBe(1);
				const count = () =>
					database.transaction({
						mode: { isolation: "readCommitted", access: "readOnly" },
						use: (transaction) =>
							transaction.execute(effectCount, {
								runId: seed.claim.runId,
								effectName: rollbackEffect,
							}),
					});
				await expect(count()).resolves.toBe(0);
				await expect(
					reserve(seed.claim as DurableClaim, {
						effectName: rollbackEffect,
						input: { attempt: 1 },
					}),
				).resolves.toMatchObject({ status: "reserved" });
				await expect(count()).resolves.toBe(1);
				const effects = await createPostgresDatabaseDurableEffectRead({
					database,
					application,
				})(seed.claim.runId);
				expect(effects.map(({ effectName }) => effectName)).toEqual([
					seed.effectName,
					rollbackEffect,
				]);
				expect(
					effects.map(({ status, receipt }) => ({ status, receipt })),
				).toEqual([
					{ status: "succeeded", receipt: "provider:recovered" },
					{ status: "pending", receipt: null },
				]);
			} finally {
				await database.close({ deadlineAt: Date.now() + 5_000 });
			}
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	},
	120_000,
);
