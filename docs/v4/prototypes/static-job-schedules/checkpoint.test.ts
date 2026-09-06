import { afterAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { SQL } from "bun";
import type { Principal } from "questpie";

import {
	createPostgresDatabaseDurableAttemptObservation,
	createPostgresDatabaseDurableKernel,
	linkJobProjection,
	linkReactionProjection,
} from "../../../../packages/runtime/src/durable";
import type { RuntimePostgres } from "../../../../packages/runtime/src/postgres/runtime";
import {
	beta05Ids,
	prepareBeta05PostgresApplication,
} from "../../../../tests/integration/postgres/helpers/beta05-runtime";
import {
	CHECKPOINT_PROOF_SCHEMA_SQL,
	createMutationCheckpointProof,
} from "./checkpoint";

const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

type MutationResult = Readonly<{
	id: string;
	channelId: string;
	body: string;
	createdAt: Date;
}>;

type GeneratedApplication = Readonly<{
	execution<Result>(
		input: Readonly<{
			principal: Principal;
			context: Readonly<{ companyId: string }>;
		}>,
		use: (
			scope: Readonly<{
				jobs: Readonly<{
					reports: Readonly<{
						companyDigest: Readonly<{
							accept(
								input: Readonly<{ companyId: string }>,
								options: Readonly<{ idempotencyKey: string }>,
							): Promise<Readonly<{ runId: string }>>;
						}>;
					}>;
				}>;
				mutations: Readonly<{
					message: Readonly<{
						publish(
							input: Readonly<{ channelId: string; body: string }>,
							options: Readonly<{ callId: string }>,
						): Promise<MutationResult>;
					}>;
				}>;
			}>,
		) => Result | Promise<Result>,
	): Promise<Awaited<Result>>;
	close(): Promise<void>;
}>;

type GeneratedInternal = Readonly<{
	createApplication(
		input: Readonly<{
			postgres: Readonly<{
				connectionUrl: string;
				directConnectionUrl: string;
			}>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
			maintenance: Readonly<{ authorize(): boolean }>;
		}>,
	): Promise<GeneratedApplication>;
}>;

function postgresUrl(databaseName?: string): string {
	const url = new URL("postgres://localhost/");
	url.hostname = process.env.PGHOST ?? "127.0.0.1";
	url.port = process.env.PGPORT ?? "5432";
	url.username = process.env.PGUSER ?? "postgres";
	url.pathname = `/${databaseName ?? process.env.PGDATABASE ?? "postgres"}`;
	if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
	return url.toString();
}

function postgresConfiguration(connectionUrl: string) {
	return {
		connectionUrl,
		directConnectionUrl: connectionUrl,
		pool: {
			max: 4,
			connectTimeoutMs: 5_000,
			checkoutTimeoutMs: 5_000,
			idleTimeoutMs: 1_000,
			maxLifetimeSeconds: 60,
		},
		timeouts: {
			statementMs: 10_000,
			lockMs: 2_000,
			idleInTransactionMs: 10_000,
		},
	} as const;
}

postgresTest(
	"recovers a committed Mutation receipt under a successor lease without a second write",
	async () => {
		const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const databaseName = `qp_checkpoint_${suffix}`;
		const connectionUrl = postgresUrl(databaseName);
		const previousDatabaseName = process.env.PGDATABASE;
		let ownsDatabase = false;
		let setupDatabase: SQL | undefined;
		let runtimeDatabase: RuntimePostgres | undefined;
		let application: GeneratedApplication | undefined;
		let prepared:
			| Awaited<ReturnType<typeof prepareBeta05PostgresApplication>>
			| undefined;
		const failures: unknown[] = [];
		try {
			await admin!.unsafe(`CREATE DATABASE "${databaseName}"`);
			ownsDatabase = true;
			process.env.PGDATABASE = databaseName;
			setupDatabase = new SQL(connectionUrl, { max: 2 });
			const [connected] = await setupDatabase`
				SELECT current_database() AS name,
				       current_setting('server_version_num')::integer AS version
			`;
			expect(connected.name).toBe(databaseName);
			expect(connected.version).toBeGreaterThanOrEqual(170_000);
			expect(connected.version).toBeLessThan(180_000);

			prepared = await prepareBeta05PostgresApplication(setupDatabase);
			await setupDatabase.unsafe(CHECKPOINT_PROOF_SCHEMA_SQL);
			const internal =
				(await prepared.generated.loadInternal()) as GeneratedInternal;
			application = await internal.createApplication({
				postgres: { connectionUrl, directConnectionUrl: connectionUrl },
				realtime: { hmacKey: new Uint8Array(32).fill(43) },
				maintenance: { authorize: () => false },
			});
			const framework = prepared.generated.framework as Readonly<{
				principal: Readonly<{
					user(input: Readonly<{ id: string }>): Principal;
				}>;
			}>;
			const principal = framework.principal.user({ id: beta05Ids.principal });
			const execution = Object.freeze({
				principal,
				context: Object.freeze({ companyId: beta05Ids.company }),
			});
			const generatedRoot = prepared.generated.generatedRoot;
			const runtimeBuild = JSON.parse(prepared.runtimeBuildBytes) as Readonly<{
				digest: string;
			}>;
			const jobs = linkJobProjection(
				JSON.parse(
					await readFile(join(generatedRoot, "job-projection.json"), "utf8"),
				),
			);
			const reactions = linkReactionProjection(
				JSON.parse(
					await readFile(
						join(generatedRoot, "reaction-projection.json"),
						"utf8",
					),
				),
			);
			const executables = JSON.parse(
				await readFile(join(generatedRoot, "runtime-executables.json"), "utf8"),
			) as Readonly<{
				slots: readonly Readonly<{
					identity: string;
					contractDigest: string;
					runtimeGraphDigest: string;
				}>[];
			}>;
			const mutationExecutable = executables.slots.find(
				(slot) => slot.identity === "mutation:message.publish",
			);
			if (!mutationExecutable)
				throw new TypeError("generated Mutation executable is unavailable");

			// Load the generated bundle before the runtime PostgreSQL implementation;
			// this preserves the repository's Bun/pg module initialization order.
			const { createRuntimePostgres } =
				await import("../../../../packages/runtime/src/postgres");
			runtimeDatabase = createRuntimePostgres(
				postgresConfiguration(connectionUrl),
			);
			const attemptPostgres = createPostgresDatabaseDurableAttemptObservation({
				database: runtimeDatabase,
			});
			const kernel = createPostgresDatabaseDurableKernel({
				database: runtimeDatabase,
				attemptDatabase: attemptPostgres.database,
				application: "application:collaboration",
				runtimeBuildDigest: runtimeBuild.digest,
				reactions,
				jobs,
			});
			const checkpoint = createMutationCheckpointProof({
				database: runtimeDatabase,
				application: "application:collaboration",
			});

			const accepted = await application.execution(execution, ({ jobs }) =>
				jobs.reports.companyDigest.accept(
					{ companyId: beta05Ids.company },
					{ idempotencyKey: `checkpoint-${suffix}` },
				),
			);
			const firstOutcome = await kernel.claim({
				runId: accepted.runId,
				workerId: `checkpoint-first-${suffix}`,
				leaseMilliseconds: 1_000,
			});
			if (firstOutcome.status !== "claimed")
				throw new TypeError("first Job attempt was not claimed");
			const firstClaim = firstOutcome.claim;
			const mutationInput = Object.freeze({
				channelId: beta05Ids.channel,
				body: `checkpoint-write-${suffix}`,
			});
			const command = Object.freeze({
				ordinal: 1,
				name: "publish-message",
				operation: "mutation:message.publish",
				input: mutationInput,
				contractDigest: mutationExecutable.contractDigest,
				runtimeGraphDigest: mutationExecutable.runtimeGraphDigest,
			});
			const reserved = await checkpoint.reserve(firstClaim, command);
			expect(reserved.status).toBe("reserved");
			if (reserved.status !== "reserved")
				throw new TypeError("checkpoint reservation failed");
			const committed = await application.execution(
				execution,
				({ mutations }) =>
					mutations.message.publish(mutationInput, {
						callId: reserved.callId,
					}),
			);
			expect(committed.body).toBe(mutationInput.body);
			// Deliberate crash window: Mutation committed, checkpoint not completed.
			expect((await checkpoint.inspect(accepted.runId, 1))?.state).toBe(
				"reserved",
			);

			await setupDatabase`
				UPDATE collaboration.memberships
				SET status = 'revoked'
				WHERE id = ${beta05Ids.membership}
			`;
			await expect(
				application.execution(execution, ({ mutations }) =>
					mutations.message.publish(mutationInput, {
						callId: reserved.callId,
					}),
				),
			).rejects.toMatchObject({ code: "notFound", resource: "tenant" });
			const [afterContextDenial] = await setupDatabase`
				SELECT count(*)::integer AS writes
				FROM collaboration.messages
				WHERE body = ${mutationInput.body}
			`;
			expect(afterContextDenial.writes).toBe(1);

			// Candidate distinction: Context remains valid after role demotion. The
			// existing receipt returns its originally authorized immutable result;
			// Collection field Policy is not re-executed on exact receipt replay.
			await setupDatabase`
				UPDATE collaboration.memberships
				SET status = 'active', role = 'member'
				WHERE id = ${beta05Ids.membership}
			`;
			const policyCharacterization = await application.execution(
				execution,
				({ mutations }) =>
					mutations.message.publish(mutationInput, {
						callId: reserved.callId,
					}),
			);
			expect(policyCharacterization.body).toBe(mutationInput.body);
			await expect(
				application.execution(execution, ({ mutations }) =>
					mutations.message.publish(mutationInput, {
						callId: `${reserved.callId}:fresh`,
					}),
				),
			).rejects.toMatchObject({
				code: "CHANNEL_UNAVAILABLE",
				status: 404,
			});

			await setupDatabase`
				UPDATE collaboration.memberships
				SET role = 'admin'
				WHERE id = ${beta05Ids.membership}
			`;
			await Bun.sleep(1_100);
			const successorOutcome = await kernel.claim({
				runId: accepted.runId,
				workerId: `checkpoint-successor-${suffix}`,
				leaseMilliseconds: 30_000,
			});
			if (successorOutcome.status !== "claimed")
				throw new TypeError("successor Job attempt was not claimed");
			const successorClaim = successorOutcome.claim;
			const recoveredReservation = await checkpoint.reserve(
				successorClaim,
				command,
			);
			expect(recoveredReservation).toMatchObject({
				status: "reserved",
				callId: reserved.callId,
			});
			const replayed = await application.execution(execution, ({ mutations }) =>
				mutations.message.publish(mutationInput, {
					callId: reserved.callId,
				}),
			);
			expect(replayed).toEqual(committed);
			expect(await checkpoint.complete(successorClaim, command)).toMatchObject({
				status: "completed",
			});
			expect(await checkpoint.complete(firstClaim, command)).toEqual({
				status: "fenced",
			});

			const [facts] = await setupDatabase`
				SELECT
				  (SELECT count(*)::integer FROM collaboration.messages WHERE body = ${mutationInput.body}) AS writes,
				  (SELECT count(*)::integer FROM questpie_internal.mutation_call_receipts WHERE call_id = ${reserved.callId}) AS receipts,
				  (SELECT count(*)::integer FROM checkpoint_proof.mutation_checkpoints WHERE run_id = ${accepted.runId}) AS checkpoints,
				  (SELECT count(*)::integer FROM information_schema.columns WHERE table_schema = 'checkpoint_proof' AND table_name = 'mutation_checkpoints' AND column_name = 'result_bytes') AS copied_result_columns
			`;
			expect(facts).toEqual({
				writes: 1,
				receipts: 1,
				checkpoints: 1,
				copied_result_columns: 0,
			});
			const completed = await checkpoint.inspect(accepted.runId, 1);
			expect(completed).toMatchObject({
				state: "completed",
				callId: reserved.callId,
			});
			expect(completed?.receiptTransactionId).not.toBeNull();
		} catch (error) {
			failures.push(error);
		} finally {
			try {
				await application?.close();
			} catch (error) {
				failures.push(error);
			}
			try {
				await runtimeDatabase?.close({ deadlineAt: Date.now() + 5_000 });
			} catch (error) {
				failures.push(error);
			}
			try {
				await prepared?.dispose();
			} catch (error) {
				failures.push(error);
			}
			try {
				await setupDatabase?.close({ timeout: 0 });
			} catch (error) {
				failures.push(error);
			}
			if (previousDatabaseName === undefined) delete process.env.PGDATABASE;
			else process.env.PGDATABASE = previousDatabaseName;
			if (ownsDatabase) {
				try {
					await admin!.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
				} catch (error) {
					failures.push(error);
				}
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				"checkpoint proof and cleanup failures",
			);
	},
	120_000,
);
