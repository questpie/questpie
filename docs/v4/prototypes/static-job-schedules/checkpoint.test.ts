import { afterAll, expect, test } from "bun:test";
import { copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { SQL } from "bun";
import type { Principal } from "questpie";

import { compileApplication } from "@questpie/compiler";

import { decodeRuntimeCodecDescriptor } from "../../../../packages/runtime/src/codec";
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
import { createMutationCheckpointInvocationProof } from "./checkpoint-invocation";

const admin = process.env.PGHOST ? new SQL({ max: 1 }) : undefined;
const postgresTest = process.env.PGHOST ? test.serial : test.skip;

afterAll(async () => {
	await admin?.close({ timeout: 0 });
});

type MutationInput = Readonly<{
	channelId: string;
	body: string;
	metadata: Readonly<{ at: Date; note?: string }>;
}>;

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
							input: MutationInput,
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
			const applicationRoot = resolve(
				prepared.generated.generatedRoot,
				"../..",
			);
			await copyFile(
				join(import.meta.dir, "checkpoint-publish.fixture.ts"),
				join(applicationRoot, "src/message-publish.ts"),
			);
			await compileApplication({ applicationRoot });
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
			const runtimeBuild = JSON.parse(
				await readFile(join(generatedRoot, "runtime-build.json"), "utf8"),
			) as Readonly<{
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
			const mutationProjection = JSON.parse(
				await readFile(join(generatedRoot, "mutation-projection.json"), "utf8"),
			) as {
				mutations: readonly { identity: string; input: unknown }[];
			};
			const inputCodec = decodeRuntimeCodecDescriptor(
				mutationProjection.mutations.find(
					(mutation) => mutation.identity === "mutation:message.publish",
				)?.input,
			);

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
				metadata: { at: new Date("2026-09-06T12:34:56.789Z") },
			});
			const command = Object.freeze({
				ordinal: 1,
				name: "publish-message",
				operation: "mutation:message.publish",
				input: mutationInput,
				inputCodec,
				contractDigest: mutationExecutable.contractDigest,
				runtimeGraphDigest: mutationExecutable.runtimeGraphDigest,
			});
			const invoke = (input: MutationInput, callId: string) =>
				application!.execution(execution, ({ mutations }) =>
					mutations.message.publish(input, { callId }),
				);
			const bindAttempt = (claim: typeof firstClaim, historyLength = 1) =>
				createMutationCheckpointInvocationProof({
					checkpoint,
					claim,
					historyLength,
					binding: {
						operation: command.operation,
						inputCodec,
						contractDigest: command.contractDigest,
						runtimeGraphDigest: command.runtimeGraphDigest,
						invoke,
					},
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
			expect(committed.createdAt.toISOString()).toBe(
				"2026-09-06T12:34:56.789Z",
			);
			// Deliberate crash window: Mutation committed, checkpoint not completed.
			expect((await checkpoint.inspect(accepted.runId, 1))?.state).toBe(
				"reserved",
			);

			await setupDatabase`
				UPDATE collaboration.memberships
				SET status = 'revoked'
				WHERE id = ${beta05Ids.membership}
			`;
			const deniedAttempt = bindAttempt(firstClaim);
			await expect(
				deniedAttempt.mutation(
					"publish-message",
					deniedAttempt.reference,
					mutationInput,
				),
			).rejects.toMatchObject({ code: "notFound", resource: "tenant" });
			expect((await checkpoint.inspect(accepted.runId, 1))?.state).toBe(
				"reserved",
			);
			await expect(
				deniedAttempt.mutation(
					"must-not-dispatch",
					deniedAttempt.reference,
					mutationInput,
				),
			).rejects.toMatchObject({ code: "notFound", resource: "tenant" });
			await expect(deniedAttempt.finish()).rejects.toMatchObject({
				code: "notFound",
				resource: "tenant",
			});
			expect(await checkpoint.inspect(accepted.runId, 2)).toBeNull();
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
			const successor = bindAttempt(successorClaim);
			const replayInput = {
				...mutationInput,
				body: mutationInput.body as string,
				metadata: { at: new Date("2026-09-06T12:34:56.789Z") },
			};
			const replayPromise = successor.mutation(
				"publish-message",
				successor.reference,
				replayInput,
			);
			replayInput.metadata.at.setUTCFullYear(2030);
			replayInput.body = "must-not-change-command";
			const replayed = await replayPromise;
			expect(replayed).toEqual(committed);
			await successor.finish();
			expect(Object.keys(successor).sort()).toEqual([
				"finish",
				"mutation",
				"reference",
			]);
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

			const freshAttempt = async (label: string) => {
				const accepted = await application!.execution(execution, ({ jobs }) =>
					jobs.reports.companyDigest.accept(
						{ companyId: beta05Ids.company },
						{ idempotencyKey: `checkpoint-${label}-${suffix}` },
					),
				);
				const outcome = await kernel.claim({
					runId: accepted.runId,
					workerId: `checkpoint-${label}-${suffix}`,
					leaseMilliseconds: 30_000,
				});
				if (outcome.status !== "claimed")
					throw new Error("proof Job was not claimed");
				return { owner: bindAttempt(outcome.claim, 0), runId: accepted.runId };
			};
			const hostileInput = {
				...mutationInput,
				body: `hostile-${suffix}`,
				metadata: { ...mutationInput.metadata, note: 42 },
			} as unknown as MutationInput;
			await expect(
				invoke(hostileInput, `direct-hostile-${suffix}`),
			).rejects.toMatchObject({
				code: "PROTOCOL_UNSUPPORTED",
				retryable: false,
			});
			const { owner: hostile, runId: hostileRunId } =
				await freshAttempt("invalid");
			await expect(
				hostile.mutation("reject-invalid", hostile.reference, hostileInput),
			).rejects.toMatchObject({
				code: "PROTOCOL_UNSUPPORTED",
				retryable: false,
			});
			await expect(hostile.finish()).rejects.toThrow();
			expect(await checkpoint.inspect(hostileRunId, 1)).toBeNull();
			for (const [label, reference] of [
				["forged", {}],
				["borrowed", successor.reference],
				[
					"callable",
					() => {
						throw new Error("must not execute caller callback");
					},
				],
			] as const) {
				const { owner, runId } = await freshAttempt(label);
				await expect(
					owner.mutation("invalid-reference", reference, mutationInput),
				).rejects.toThrow("CHECKPOINT_REFERENCE_INVALID");
				await expect(owner.finish()).rejects.toThrow(
					"CHECKPOINT_REFERENCE_INVALID",
				);
				expect(await checkpoint.inspect(runId, 1)).toBeNull();
			}
			const { owner: rejected, runId: rejectedRunId } =
				await freshAttempt("declared-error");
			const unavailable = {
				...mutationInput,
				channelId: "00000000-0000-4000-8000-000000000099",
			};
			const declaredFailure = await rejected
				.mutation("unavailable-channel", rejected.reference, unavailable)
				.catch((error: unknown) => error);
			expect(declaredFailure).toMatchObject({
				code: "CHANNEL_UNAVAILABLE",
				status: 404,
			});
			await expect(
				rejected.mutation(
					"must-not-continue",
					rejected.reference,
					mutationInput,
				),
			).rejects.toBe(declaredFailure);
			await expect(rejected.finish()).rejects.toBe(declaredFailure);
			const rejectedCheckpoint = await checkpoint.inspect(rejectedRunId, 1);
			expect(rejectedCheckpoint?.state).toBe("reserved");
			expect(await checkpoint.inspect(rejectedRunId, 2)).toBeNull();
			const [failedReceipt] =
				await setupDatabase`SELECT count(*)::integer AS count FROM questpie_internal.mutation_call_receipts WHERE call_id = ${rejectedCheckpoint!.callId}`;
			expect(failedReceipt.count).toBe(0);
			const { owner: oversized, runId: oversizedRunId } =
				await freshAttempt("byte-limit");
			await expect(
				oversized.mutation("too-large", oversized.reference, {
					...mutationInput,
					body: "é".repeat(524_288),
				}),
			).rejects.toThrow("CHECKPOINT_INPUT_LIMIT");
			await expect(oversized.finish()).rejects.toThrow(
				"CHECKPOINT_INPUT_LIMIT",
			);
			expect(await checkpoint.inspect(oversizedRunId, 1)).toBeNull();

			const { owner: sequential, runId: sequentialRunId } =
				await freshAttempt("sequential");
			const firstSequential = await sequential.mutation(
				"first",
				sequential.reference,
				{
					...mutationInput,
					body: `first-${suffix}`,
					metadata: { ...mutationInput.metadata, note: "present" },
				},
			);
			const secondSequential = await sequential.mutation(
				"second",
				sequential.reference,
				{ ...mutationInput, body: `second-${suffix}` },
			);
			await sequential.finish();
			expect(firstSequential.body).toBe(`first-${suffix}`);
			expect(secondSequential.body).toBe(`second-${suffix}`);
			expect(firstSequential.id).not.toBe(secondSequential.id);
			for (const ordinal of [1, 2])
				expect(
					(await checkpoint.inspect(sequentialRunId, ordinal))?.state,
				).toBe("completed");
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
