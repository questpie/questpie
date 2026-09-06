import { expect, test } from "bun:test";

import { SQL } from "bun";
import { Client } from "pg";
import { codec, defineContext, principal } from "questpie";

import { digest } from "../../../packages/compiler/src/canonical";
import { projectPostgresMutationTransactionStatements } from "../../../packages/compiler/src/mutation/postgres-transaction-statements";
import { ensureInternalProtocolV8 } from "../../../packages/compiler/src/schema/postgres/internal-protocol-v8";
import {
	ensureInternalProtocolV9,
	verifyInternalProtocolV9,
} from "../../../packages/compiler/src/schema/postgres/internal-protocol-v9";
import { createJobAcceptance } from "../../../packages/runtime/src/durable/acceptance";
import type { LinkedJobMember } from "../../../packages/runtime/src/durable/job-projection";
import { createPostgresStaticSchedules } from "../../../packages/runtime/src/durable/schedule";
import { parseUtcCron } from "../../../packages/runtime/src/durable/schedule/contract";
import { createApplicationRuntime } from "../../../packages/runtime/src/execution";
import { createPostgresJobAcceptanceTransaction } from "../../../packages/runtime/src/mutation/postgres-job-acceptance";
import { linkPostgresMutationTransactionStatements } from "../../../packages/runtime/src/mutation/postgres-transaction-statements";
import { createRuntimePostgres } from "../../../packages/runtime/src/postgres";
import type { PostgresTransactionRunner } from "../../../packages/runtime/src/postgres/contract";
import { expectPostgresMajor } from "./helpers/postgres-major";

const postgres = process.env.PGHOST ? test : test.skip;

postgres(
	"static schedules serialize ten ordinary Job producers, replay activation, and roll back acceptance",
	async () => {
		const ownedDatabase = `qp_schedule_${crypto.randomUUID().replaceAll("-", "")}`;
		const admin = new Client({ database: "postgres" });
		await admin.connect();
		let created = false;
		let sql: SQL | undefined;
		let database: ReturnType<typeof createRuntimePostgres> | undefined;
		const previousDatabase = process.env.PGDATABASE;
		try {
			await admin.query(`CREATE DATABASE "${ownedDatabase}"`);
			created = true;
			process.env.PGDATABASE = ownedDatabase;
			const url = new URL("postgres://localhost/");
			url.hostname = process.env.PGHOST!;
			url.port = process.env.PGPORT ?? "5432";
			url.username = process.env.PGUSER ?? "postgres";
			if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
			url.pathname = `/${ownedDatabase}`;
			sql = new SQL(url.toString(), { max: 1 });
			const [environment] =
				await sql`SELECT current_database() AS database, current_setting('server_version_num')::int AS version, pg_backend_pid() AS pid`;
			expect(environment.database).toBe(ownedDatabase);
			expectPostgresMajor(environment.version);
			await ensureInternalProtocolV8(sql, ownedDatabase, environment.pid, {
				lockTimeoutMs: 2000,
				statementTimeoutMs: 10000,
			});
			await expect(
				ensureInternalProtocolV9(sql, ownedDatabase, environment.pid, {
					lockTimeoutMs: 2000,
					statementTimeoutMs: 10000,
				}),
			).rejects.toThrow();
			await ensureInternalProtocolV9(
				sql,
				ownedDatabase,
				environment.pid,
				{ lockTimeoutMs: 2000, statementTimeoutMs: 10000 },
				{ allowNonRollingProtocolV9: true },
			);
			await verifyInternalProtocolV9(sql);
			const failureCatalog =
				await sql`SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'questpie_internal'::regnamespace AND pg_get_constraintdef(oid) LIKE '%HANDLER_FAILED%' ORDER BY conname`;
			expect(failureCatalog).toHaveLength(2);
			for (const constraint of failureCatalog)
				expect(constraint.definition).toContain("CHECKPOINT_INVALID");
			database = createRuntimePostgres({
				connectionUrl: url.toString(),
				directConnectionUrl: url.toString(),
				pool: {
					max: 12,
					connectTimeoutMs: 2000,
					checkoutTimeoutMs: 5000,
					idleTimeoutMs: 2000,
					maxLifetimeSeconds: 60,
				},
				timeouts: {
					statementMs: 10000,
					lockMs: 5000,
					idleInTransactionMs: 10000,
				},
			});
			const bindings = {
				application: "application:schedule-proof",
				compilerRuntimeBuildDigest: "a".repeat(64),
				jobProjectionDigest: "b".repeat(64),
			};
			const program = (service = "sweep") => {
				const value = {
					jobIdentity: "job:sweep",
					cron: parseUtcCron("* * * * *"),
					principal: { kind: "service" as const, id: service },
					contextJson: '{"tenant":"tenant-one"}\n',
					inputJson: "{}\n",
				};
				return {
					...value,
					programDigest: digest("questpie-job-schedule-program-v1", value),
				};
			};
			const artifact = (programs = [program()]) => ({
				format: "questpie.job-schedules",
				version: 1,
				...bindings,
				schedules: programs,
				digest: digest("questpie-job-schedule-set-v1", {
					application: bindings.application,
					schedules: programs,
				}),
			});
			const statementsArtifact = projectPostgresMutationTransactionStatements();
			const acceptanceStatements = linkPostgresMutationTransactionStatements({
				artifact: JSON.stringify(statementsArtifact),
				expectedDigest: statementsArtifact.digest,
			});
			let contextCalls = 0;
			let denyContext = false;
			let failAfterAcceptance = false;
			let acceptanceHold: Promise<void> | undefined;
			let enteredAcceptance: (() => void) | undefined;
			const context = defineContext({
				name: "schedule.context",
				input: codec.object({ tenant: codec.text() }),
				resolve: ({ input, principal: actor }) => {
					contextCalls++;
					if (denyContext) throw new Error("CONTEXT_DENIED");
					expect(actor.kind).toBe("service");
					return { tenant: { id: input.tenant }, values: {} };
				},
			});
			const runtime = createApplicationRuntime({
				services: [],
				context,
				bootstrap: () => ({
					read: async () => {
						throw new Error("unexpected bootstrap read");
					},
				}),
				project: (scope) => scope.facts,
			});
			const job: LinkedJobMember = {
				identity: "job:sweep",
				member: "sweep",
				semanticVersion: 1,
				input: { kind: "object", properties: {} },
				output: { kind: "object", properties: {} },
				declaredErrors: {},
				runAs: { actor: "caller", whenDenied: "fail" },
				retry: {
					maximumAttempts: 3,
					initialDelayMilliseconds: 1,
					maximumDelayMilliseconds: 100,
					horizonMilliseconds: 60000,
					backoff: "exponential",
					jitter: "full",
				},
				contractDigest: "c".repeat(64),
			};
			const owner = (
				catalog = artifact(),
				runner: PostgresTransactionRunner = database!,
			) =>
				createPostgresStaticSchedules({
					database: runner,
					artifact: catalog,
					bindings,
					accept: async (request) => {
						enteredAcceptance?.();
						await acceptanceHold;
						return runtime.execution(
							{
								principal: principal.service({
									name: request.schedule.principal.id,
								}),
								context: JSON.parse(request.schedule.contextJson),
								signal: request.signal,
							},
							async (facts) => {
								expect(facts.authority).toEqual({ kind: "ordinary" });
								const receipt = await createJobAcceptance({
									application: bindings.application,
									tenantId: facts.tenant.id,
									principal: facts.principal,
									contextInput: facts.contextInput,
									contextInputCodec: context.input,
									runtimeBuildDigest: "d".repeat(64),
									acceptedAt: request.observedAt,
									signal: facts.signal,
									causation: {
										kind: "explicit",
										id: `schedule:${request.tickId}`,
										correlationId: request.tickId,
									},
									transaction: createPostgresJobAcceptanceTransaction({
										transaction: request.transaction,
										statements: acceptanceStatements,
										application: bindings.application,
										sourceOperation: "schedule:accept",
										callId: request.tickId,
									}),
								}).accept(
									{ ...job, identity: request.schedule.jobIdentity },
									JSON.parse(request.schedule.inputJson),
									{
										idempotencyKey: request.tickId,
									},
								);
								if (failAfterAcceptance) throw new Error("ACCEPTANCE_ROLLBACK");
								return receipt;
							},
						);
					},
				});
			const active = owner();
			const empty = owner(artifact([]));
			try {
				expect(await active.reconcile()).toEqual({
					status: "inactive",
					accepted: 0,
					examined: 0,
				});
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.schedule_heads`
					)[0].count,
				).toBe(0);
				const first = await active.activate({ expectedRevision: "0" });
				expect(first.acceptedRevision).toBe("1");
				expect(
					(await active.activate({ expectedRevision: "0" })).replayed,
				).toBe(true);
				expect((await active.reconcile()).accepted).toBe(0);
				await sql`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp(), 'UTC') - interval '3 minutes'`;
				const contests = await Promise.all(
					Array.from({ length: 10 }, () => owner().reconcile()),
				);
				expect(contests.reduce((sum, value) => sum + value.accepted, 0)).toBe(
					1,
				);
				expect(contextCalls).toBe(1);
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.durable_runs`
					)[0].count,
				).toBe(1);
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.schedule_ticks`
					)[0].count,
				).toBe(1);
				await sql`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp(), 'UTC') + interval '1 day'`;
				const futureFrontier = (
					await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
				)[0].frontier_minute;
				expect((await active.reconcile()).accepted).toBe(0);
				expect(
					(
						await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
					)[0].frontier_minute,
				).toEqual(futureFrontier);
				const removed = await empty.activate({ expectedRevision: "1" });
				expect(removed.acceptedRevision).toBe("2");
				expect((await active.reconcile()).status).toBe("inactive");
				const readded = await active.activate({ expectedRevision: "2" });
				expect(readded.acceptedRevision).toBe("3");
				expect(
					(await active.activate({ expectedRevision: "0" })).currentHead
						.revision,
				).toBe("3");
				await expect(
					owner(artifact([program("changed")])).activate({
						expectedRevision: "1",
					}),
				).rejects.toThrow("SCHEDULE_ACTIVATION_STALE");
				// Rollback controls use a fresh logical Job so the current minute has no retained tick.
				const freshProgram = { ...program(), jobIdentity: "job:rollback" };
				const { programDigest: _, ...freshBytes } = freshProgram;
				freshProgram.programDigest = digest(
					"questpie-job-schedule-program-v1",
					freshBytes,
				);
				const rollback = owner(artifact([freshProgram]));
				await rollback.activate({ expectedRevision: "3" });
				await sql`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp(), 'UTC') - interval '3 minutes'`;
				const before = (
					await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
				)[0].frontier_minute;
				denyContext = true;
				await expect(rollback.reconcile()).rejects.toThrow("CONTEXT_DENIED");
				denyContext = false;
				failAfterAcceptance = true;
				await expect(rollback.reconcile()).rejects.toThrow(
					"ACCEPTANCE_ROLLBACK",
				);
				failAfterAcceptance = false;
				expect(
					(
						await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
					)[0].frontier_minute,
				).toEqual(before);
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.durable_runs`
					)[0].count,
				).toBe(1);
				const cancellation = new AbortController();
				const entered = Promise.withResolvers<void>();
				const held = Promise.withResolvers<void>();
				enteredAcceptance = entered.resolve;
				acceptanceHold = held.promise;
				const cancelled = rollback.reconcile({ signal: cancellation.signal });
				await entered.promise;
				cancellation.abort(new Error("PRODUCER_CANCELLED"));
				held.resolve();
				await expect(cancelled).rejects.toThrow();
				enteredAcceptance = undefined;
				acceptanceHold = undefined;
				expect(
					(
						await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
					)[0].frontier_minute,
				).toEqual(before);
				// Tick wins the shared lock: its accepted run survives the waiting removal.
				const tickEntered = Promise.withResolvers<void>();
				const tickRelease = Promise.withResolvers<void>();
				enteredAcceptance = tickEntered.resolve;
				acceptanceHold = tickRelease.promise;
				const tickFirst = rollback.reconcile();
				await tickEntered.promise;
				const removeSecond = empty.activate({ expectedRevision: "4" });
				tickRelease.resolve();
				expect((await tickFirst).accepted).toBe(1);
				await removeSecond;
				expect((await rollback.reconcile()).status).toBe("inactive");
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.durable_runs`
					)[0].count,
				).toBe(2);
				enteredAcceptance = undefined;
				acceptanceHold = undefined;
				const removalProgram = {
					...program(),
					jobIdentity: "job:removal-first",
				};
				const { programDigest: _removedDigest, ...removalBytes } =
					removalProgram;
				removalProgram.programDigest = digest(
					"questpie-job-schedule-program-v1",
					removalBytes,
				);
				const removalTarget = owner(artifact([removalProgram]));
				await removalTarget.activate({ expectedRevision: "5" });
				await sql`UPDATE questpie_internal.schedule_frontiers SET frontier_minute = date_trunc('minute', clock_timestamp(), 'UTC') - interval '1 day'`;
				const retained = (
					await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
				)[0].frontier_minute;
				await removalTarget.activate({ expectedRevision: "6" });
				expect(
					(
						await sql`SELECT frontier_minute FROM questpie_internal.schedule_frontiers`
					)[0].frontier_minute,
				).toEqual(retained);
				const removalLocked = Promise.withResolvers<void>();
				const removalRelease = Promise.withResolvers<void>();
				const removalRunner: PostgresTransactionRunner = {
					transaction: (input) =>
						database!.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									execute: async (statement, parameters) => {
										const result = await transaction.execute(
											statement,
											parameters,
										);
										if (statement.name === "durable.schedule.head.lock") {
											removalLocked.resolve();
											await removalRelease.promise;
										}
										return result;
									},
								}),
						}),
				};
				const removalFirst = owner(artifact([]), removalRunner).activate({
					expectedRevision: "7",
				});
				await removalLocked.promise;
				const queuedTick = removalTarget.reconcile();
				removalRelease.resolve();
				await removalFirst;
				expect((await queuedTick).status).toBe("inactive");
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.durable_runs`
					)[0].count,
				).toBe(2);
				const corruptRunner: PostgresTransactionRunner = {
					transaction: (input) =>
						database!.transaction({
							...input,
							use: (transaction) =>
								input.use({
									...transaction,
									execute: async (statement, parameters) => {
										const result = await transaction.execute(
											statement,
											parameters,
										);
										if (statement.name === "durable.schedule.head.update")
											throw new Error("ACTIVATION_ROLLBACK");
										return result;
									},
								}),
						}),
				};
				await expect(
					owner(artifact([removalProgram]), corruptRunner).activate({
						expectedRevision: "8",
					}),
				).rejects.toThrow("ACTIVATION_ROLLBACK");
				expect(
					(
						await sql`SELECT revision::text AS revision FROM questpie_internal.schedule_heads`
					)[0].revision,
				).toBe("8");
				expect(
					(
						await sql`SELECT count(*)::int AS count FROM questpie_internal.schedule_frontiers`
					)[0].count,
				).toBe(0);
				await sql`UPDATE questpie_internal.schedule_heads SET revision = 9223372036854775807`;
				await expect(
					active.activate({ expectedRevision: "9223372036854775807" }),
				).rejects.toThrow("SCHEDULE_REVISION_OVERFLOW");
			} finally {
				await runtime.close();
			}
		} finally {
			await database?.close({ deadlineAt: Date.now() + 5000 });
			await sql?.close({ timeout: 2 });
			if (previousDatabase === undefined) delete process.env.PGDATABASE;
			else process.env.PGDATABASE = previousDatabase;
			if (created) await admin.query(`DROP DATABASE "${ownedDatabase}"`);
			await admin.end();
		}
	},
	60000,
);
