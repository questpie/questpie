import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { z } from "zod";

import { job } from "../../src/exports/index.js";
import { withTransaction } from "../../src/server/collection/crud/shared/transaction.js";
import { PgBossAdapter } from "../../src/server/modules/core/integrated/queue/adapters/pg-boss.js";
import { stableQueueDispatchId } from "../../src/server/modules/core/integrated/queue/dispatch-store.js";
import { questpieQueueDispatchTable } from "../../src/server/modules/core/integrated/queue/dispatch-table.js";
import { createQueueClient } from "../../src/server/modules/core/integrated/queue/service.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../utils/test-db.js";

const databaseUrl = process.env.QUESTPIE_QUEUE_SECRET_POSTGRES_URL;
const runPostgresContract = Boolean(databaseUrl);
const rootSecret = "queue-secret-root-key-at-least-32-bytes";
const handledPayloads: unknown[] = [];
let permanentFailureDetail = "";
let retryAttempts = 0;

const deliveryJob = job({
	name: "queue-secret-delivery",
	schema: z.object({
		invitationId: z.string(),
		rawSecret: z.string(),
	}),
	options: { retryLimit: 0 },
	handler: async ({ payload }) => {
		handledPayloads.push(payload);
	},
});

const permanentFailureJob = job({
	name: "queue-secret-permanent-failure",
	schema: z.object({
		invitationId: z.string(),
		rawSecret: z.string(),
	}),
	options: { retryLimit: 0 },
	handler: async () => {
		throw new Error(permanentFailureDetail);
	},
});

const retryJob = job({
	name: "queue-secret-retry",
	schema: z.object({
		invitationId: z.string(),
		rawSecret: z.string(),
	}),
	options: { retryLimit: 1, retryDelay: 0 },
	handler: async ({ payload }) => {
		retryAttempts += 1;
		if (retryAttempts === 1) {
			throw new Error(`temporary provider failure for ${payload.rawSecret}`);
		}
		handledPayloads.push(payload);
	},
});

const shortPolicyJob = job({
	name: "queue-secret-short-policy",
	schema: z.object({
		invitationId: z.string(),
		rawSecret: z.string(),
	}),
	options: { queuePolicy: "short", retryLimit: 0 },
	handler: async ({ payload }) => {
		handledPayloads.push(payload);
	},
});

class FailureInjectedPgBossAdapter extends PgBossAdapter {
	private publicationFailures = 0;
	private publicationReceiptFailures = 0;

	failNextPublications(count = 1): void {
		this.publicationFailures = Math.max(0, count);
	}

	failNextPublicationReceipts(count = 1): void {
		this.publicationReceiptFailures = Math.max(0, count);
	}

	override async publish(
		jobName: string,
		payload: unknown,
		options?: Parameters<PgBossAdapter["publish"]>[2],
		dispatchId?: string,
	): Promise<string | null> {
		if (this.publicationFailures > 0) {
			this.publicationFailures -= 1;
			throw new Error(
				"injected broker publication failure with provider detail",
			);
		}
		const adapterJobId = await super.publish(
			jobName,
			payload,
			options,
			dispatchId,
		);
		if (this.publicationReceiptFailures > 0) {
			this.publicationReceiptFailures -= 1;
			throw new Error("injected crash after broker publication");
		}
		return adapterJobId;
	}
}

describe.skipIf(!runPostgresContract)(
	"secret-bearing transactional Queue dispatch on PostgreSQL",
	() => {
		let setup: Awaited<ReturnType<typeof buildMockApp>>;
		let queue: ReturnType<
			typeof createQueueClient<{
				delivery: typeof deliveryJob;
				permanentFailure: typeof permanentFailureJob;
				retry: typeof retryJob;
				shortPolicy: typeof shortPolicyJob;
			}>
		>;
		let adapter: FailureInjectedPgBossAdapter;

		beforeAll(async () => {
			const pool = new pg.Pool({ connectionString: databaseUrl! });
			try {
				await pool.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
				await pool.query(
					"DROP SCHEMA IF EXISTS pgboss_queue_secret_contract CASCADE",
				);
			} finally {
				await pool.end();
			}
			setup = await buildMockApp(
				{
					jobs: {
						delivery: deliveryJob,
						permanentFailure: permanentFailureJob,
						retry: retryJob,
						shortPolicy: shortPolicyJob,
					},
				},
				{
					db: { url: databaseUrl! },
					secret: rootSecret,
				},
			);
			await runTestDbMigrations(setup.app);

			adapter = new FailureInjectedPgBossAdapter({
				connectionString: databaseUrl!,
				schema: "pgboss_queue_secret_contract",
				useApplicationTransaction: false,
			});
			queue = createQueueClient(
				{
					delivery: deliveryJob,
					permanentFailure: permanentFailureJob,
					retry: retryJob,
					shortPolicy: shortPolicyJob,
				},
				adapter,
				{
					createContext: async () =>
						setup.app.createContext({
							accessMode: "system",
						}),
					getApp: () => setup.app,
					getDatabase: () => setup.app.db,
					secret: rootSecret,
					logger: {
						info: () => {},
						warn: () => {},
						error: () => {},
					},
				},
			);
		});

		afterAll(async () => {
			await queue?.stop();
			if (!setup) return;
			await setup.app.migrations.down();
			await setup.cleanup();
			const pool = new pg.Pool({ connectionString: databaseUrl! });
			try {
				await pool.query(
					"DROP SCHEMA IF EXISTS pgboss_queue_secret_contract CASCADE",
				);
			} finally {
				await pool.end();
			}
		});

		test("commits only ciphertext to the Queue ledger and broker", async () => {
			const rawSecret = "raw-invitation-token-must-never-be-persisted";
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-1",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:invitation-1:v1",
						secretPayload: true,
					},
				),
			);

			const [dispatch] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			const brokerRows = await setup.app.db.execute(sql`
				SELECT data::text AS data
				FROM pgboss_queue_secret_contract.job
				WHERE id = ${dispatchId}::uuid
			`);

			expect(dispatch).toBeDefined();
			expect(JSON.stringify(dispatch)).not.toContain(rawSecret);
			expect(JSON.stringify(brokerRows)).not.toContain(rawSecret);

			await queue.runOnce({ jobs: ["queue-secret-delivery"] });
		});

		test("decrypts only for execution, erases the data key, and retains a safe completion receipt", async () => {
			const rawSecret = "second-raw-invitation-token";
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-2",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:invitation-2:v1",
						secretPayload: true,
					},
				),
			);

			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				dispatchId,
				jobName: "queue-secret-delivery",
				status: "queued",
			});

			await queue.runOnce({ jobs: ["queue-secret-delivery"] });

			expect(handledPayloads).toContainEqual({
				invitationId: "invitation-2",
				rawSecret,
			});
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				dispatchId,
				jobName: "queue-secret-delivery",
				status: "completed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(terminal?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify(terminal)).not.toContain(rawSecret);
		});

		test("erases the data key on permanent failure and exposes no provider detail", async () => {
			const rawSecret = "terminal-raw-invitation-token";
			permanentFailureDetail = `SMTP provider rejected recipient while handling ${rawSecret}`;
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.permanentFailure.publish(
					{
						invitationId: "invitation-terminal",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:terminal:v1",
						secretPayload: true,
					},
				),
			);

			const execution = queue.runOnce({
				jobs: ["queue-secret-permanent-failure"],
			});
			await expect(execution).rejects.toThrow(
				"QUESTPIE Queue secret job handling failed",
			);
			await expect(execution).rejects.not.toThrow(rawSecret);
			await expect(execution).rejects.not.toThrow("SMTP provider");

			const receipt = await queue.getReceipt(dispatchId!);
			expect(receipt).toMatchObject({
				dispatchId,
				jobName: "queue-secret-permanent-failure",
				status: "failed",
			});
			expect(JSON.stringify(receipt)).not.toContain(rawSecret);
			expect(JSON.stringify(receipt)).not.toContain("SMTP provider");

			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			const brokerRows = await setup.app.db.execute(sql`
				SELECT data::text AS data, output::text AS output
				FROM pgboss_queue_secret_contract.job
				WHERE id = ${dispatchId}::uuid
			`);
			expect(terminal?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify({ terminal, brokerRows })).not.toContain(rawSecret);
			expect(JSON.stringify({ terminal, brokerRows })).not.toContain(
				"SMTP provider",
			);
		});

		test("retains the key across a retry and erases it after the successful attempt", async () => {
			retryAttempts = 0;
			const rawSecret = "retry-raw-invitation-token";
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.retry.publish(
					{
						invitationId: "invitation-retry",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:retry:v1",
						secretPayload: true,
					},
				),
			);

			await expect(
				queue.runOnce({ jobs: ["queue-secret-retry"] }),
			).rejects.toThrow("QUESTPIE Queue secret job handling failed");
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "queued",
				handledAt: null,
			});
			const [retrying] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(retrying?.wrappedSecretKey).not.toBeNull();

			await queue.runOnce({ jobs: ["queue-secret-retry"] });

			expect(retryAttempts).toBe(2);
			expect(handledPayloads).toContainEqual({
				invitationId: "invitation-retry",
				rawSecret,
			});
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "completed",
			});
			const [completed] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(completed?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify(completed)).not.toContain(rawSecret);
		});

		test("keeps the first encrypted payload when an idempotency key is replayed", async () => {
			const idempotencyKey = "invitation-mail:stable-version:v1";
			const first = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-stable-version",
						rawSecret: "first-version-secret",
					},
					{ idempotencyKey, secretPayload: true },
				),
			);
			const replay = await queue.delivery.publish(
				{
					invitationId: "invitation-stable-version",
					rawSecret: "changed-version-secret",
				},
				{ idempotencyKey, secretPayload: true },
			);

			expect(replay).toBe(first);
			await queue.runOnce({ jobs: ["queue-secret-delivery"] });
			expect(handledPayloads).toContainEqual({
				invitationId: "invitation-stable-version",
				rawSecret: "first-version-secret",
			});
			expect(handledPayloads).not.toContainEqual({
				invitationId: "invitation-stable-version",
				rawSecret: "changed-version-secret",
			});
			expect(await queue.getReceipt(first!)).toMatchObject({
				status: "completed",
			});
		});

		test("rolls back the secret intent with the business transaction", async () => {
			let dispatchId: string | null = null;
			await expect(
				withTransaction(setup.app.db, async () => {
					dispatchId = await queue.delivery.publish(
						{
							invitationId: "invitation-rollback",
							rawSecret: "rollback-raw-invitation-token",
						},
						{
							idempotencyKey: "invitation-mail:rollback:v1",
							secretPayload: true,
						},
					);
					throw new Error("roll back invitation issue");
				}),
			).rejects.toThrow("roll back invitation issue");

			expect(dispatchId).not.toBeNull();
			expect(await queue.getReceipt(dispatchId!)).toBeNull();
			const brokerRows = await setup.app.db.execute(sql`
				SELECT id
				FROM pgboss_queue_secret_contract.job
				WHERE id = ${dispatchId}::uuid
			`);
			expect(brokerRows).toHaveLength(0);
		});

		test("commits the pg-boss job and secret ledger row in the same application transaction", async () => {
			const transactionalAdapter = new PgBossAdapter({
				connectionString: databaseUrl!,
				schema: "pgboss_queue_secret_contract",
				useApplicationTransaction: true,
			});
			const transactionalQueue = createQueueClient(
				{ delivery: deliveryJob },
				transactionalAdapter,
				{
					createContext: async () =>
						setup.app.createContext({
							accessMode: "system",
						}),
					getApp: () => setup.app,
					getDatabase: () => setup.app.db,
					secret: rootSecret,
					logger: {
						info: () => {},
						warn: () => {},
						error: () => {},
					},
				},
			);

			try {
				const committedId = await withTransaction(setup.app.db, () =>
					transactionalQueue.delivery.publish(
						{
							invitationId: "invitation-same-db-commit",
							rawSecret: "same-db-commit-secret",
						},
						{
							idempotencyKey: "invitation-mail:same-db-commit:v1",
							secretPayload: true,
						},
					),
				);
				const committedBrokerRows = await setup.app.db.execute(sql`
					SELECT id
					FROM pgboss_queue_secret_contract.job
					WHERE id = ${committedId}::uuid
				`);
				expect(await transactionalQueue.getReceipt(committedId!)).toMatchObject(
					{
						status: "queued",
					},
				);
				expect(committedBrokerRows).toHaveLength(1);

				let rolledBackId: string | null = null;
				await expect(
					withTransaction(setup.app.db, async () => {
						rolledBackId = await transactionalQueue.delivery.publish(
							{
								invitationId: "invitation-same-db-rollback",
								rawSecret: "same-db-rollback-secret",
							},
							{
								idempotencyKey: "invitation-mail:same-db-rollback:v1",
								secretPayload: true,
							},
						);
						throw new Error("roll back same-database dispatch");
					}),
				).rejects.toThrow("roll back same-database dispatch");
				const rolledBackBrokerRows = await setup.app.db.execute(sql`
					SELECT id
					FROM pgboss_queue_secret_contract.job
					WHERE id = ${rolledBackId}::uuid
				`);
				expect(await transactionalQueue.getReceipt(rolledBackId!)).toBeNull();
				expect(rolledBackBrokerRows).toHaveLength(0);
			} finally {
				await transactionalQueue.stop();
			}
		});

		test("recovers a broker-owned terminal timeout after process restart", async () => {
			const rawSecret = "broker-timeout-raw-invitation-token";
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-broker-timeout",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:broker-timeout:v1",
						secretPayload: true,
					},
				),
			);

			// pg-boss's supervisor owns expiry/heartbeat terminalization. Model the
			// durable result left for a restarted QUESTPIE process to inspect; this
			// path does not invoke the QUESTPIE handler or receive finalAttempt.
			await setup.app.db.execute(sql`
				UPDATE pgboss_queue_secret_contract.job
				SET
					state = 'failed',
					completed_on = CURRENT_TIMESTAMP,
					output = '{"value":{"message":"job heartbeat timeout"}}'::jsonb
				WHERE id = ${dispatchId}::uuid
			`);

			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "queued",
			});
			await expect(queue.drain()).resolves.toMatchObject({
				terminal: 1,
			});
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "failed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(terminal?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify(terminal)).not.toContain(rawSecret);
			expect(JSON.stringify(terminal)).not.toContain("heartbeat timeout");
		});

		test("recovers a committed encrypted intent after broker publication fails", async () => {
			const rawSecret = "recoverable-raw-invitation-token";
			adapter.failNextPublications();
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-recover",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:recover:v1",
						secretPayload: true,
					},
				),
			);

			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "queued",
				queuedAt: null,
			});
			const [pending] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(pending?.wrappedSecretKey).not.toBeNull();
			expect(JSON.stringify(pending)).not.toContain(rawSecret);

			await setup.app.db
				.update(questpieQueueDispatchTable)
				.set({ availableAt: new Date(0) })
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			await expect(queue.drain()).resolves.toMatchObject({
				accepted: 1,
			});
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "queued",
				queuedAt: expect.any(Date),
			});

			await queue.runOnce({ jobs: ["queue-secret-delivery"] });
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "completed",
			});
		});

		test("recovers stable pg-boss identity after a crash between broker publication and ledger acceptance", async () => {
			const rawSecret = "post-publication-crash-raw-invitation-token";
			adapter.failNextPublicationReceipts();
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-post-publication-crash",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:post-publication-crash:v1",
						secretPayload: true,
					},
				),
			);

			const brokerRows = await setup.app.db.execute(sql`
				SELECT id
				FROM pgboss_queue_secret_contract.job
				WHERE id = ${dispatchId}::uuid
			`);
			expect(brokerRows).toHaveLength(1);
			const [unacknowledged] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(unacknowledged).toMatchObject({
				status: "pending",
				adapterJobId: null,
			});
			expect(unacknowledged?.wrappedSecretKey).not.toBeNull();

			await setup.app.db
				.update(questpieQueueDispatchTable)
				.set({ availableAt: new Date(0) })
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			await expect(queue.drain()).resolves.toMatchObject({
				accepted: 1,
			});
			const [recovered] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(recovered).toMatchObject({
				status: "accepted",
				adapterJobId: dispatchId,
			});

			await setup.app.db.execute(sql`
				UPDATE pgboss_queue_secret_contract.job
				SET
					state = 'failed',
					completed_on = CURRENT_TIMESTAMP,
					output = '{"value":{"message":"job timed out"}}'::jsonb
				WHERE id = ${dispatchId}::uuid
			`);
			await expect(queue.drain()).resolves.toMatchObject({
				terminal: 1,
			});
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "failed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(terminal?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify(terminal)).not.toContain(rawSecret);
		});

		test("does not fabricate acceptance when a short-policy conflict suppresses a distinct dispatch", async () => {
			const firstPayload = {
				invitationId: "invitation-short-policy-first",
				rawSecret: "short-policy-first-secret",
			};
			const secondPayload = {
				invitationId: "invitation-short-policy-second",
				rawSecret: "short-policy-second-secret",
			};
			const firstDispatchId = await withTransaction(setup.app.db, () =>
				queue.shortPolicy.publish(firstPayload, {
					idempotencyKey: "invitation-mail:short-policy:first:v1",
					secretPayload: true,
				}),
			);
			const secondDispatchId = await withTransaction(setup.app.db, () =>
				queue.shortPolicy.publish(secondPayload, {
					idempotencyKey: "invitation-mail:short-policy:second:v1",
					secretPayload: true,
				}),
			);

			expect(secondDispatchId).not.toBe(firstDispatchId);
			const [firstDispatch] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, firstDispatchId));
			const [secondDispatch] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, secondDispatchId));
			const brokerRowsBeforeRelease = await setup.app.db.execute(sql`
				SELECT id::text AS id
				FROM pgboss_queue_secret_contract.job
				WHERE name = 'queue-secret-short-policy'
				ORDER BY created_on, id
			`);

			expect(firstDispatch).toMatchObject({
				status: "accepted",
				adapterJobId: firstDispatchId,
			});
			expect(secondDispatch).toMatchObject({
				status: "pending",
				adapterJobId: null,
				acceptedAt: null,
			});
			expect(secondDispatch?.wrappedSecretKey).not.toBeNull();
			expect(brokerRowsBeforeRelease).toEqual([{ id: firstDispatchId }]);
			expect(await queue.getReceipt(secondDispatchId!)).toMatchObject({
				status: "queued",
				queuedAt: null,
			});

			await queue.runOnce({ jobs: ["queue-secret-short-policy"] });
			await setup.app.db
				.update(questpieQueueDispatchTable)
				.set({ availableAt: new Date(0) })
				.where(eq(questpieQueueDispatchTable.dispatchId, secondDispatchId));
			await expect(queue.drain()).resolves.toMatchObject({
				accepted: 1,
				failed: 0,
			});
			const secondBrokerRows = await setup.app.db.execute(sql`
				SELECT id::text AS id
				FROM pgboss_queue_secret_contract.job
				WHERE id = ${secondDispatchId}::uuid
			`);
			expect(secondBrokerRows).toEqual([{ id: secondDispatchId }]);

			await queue.runOnce({ jobs: ["queue-secret-short-policy"] });
			expect(handledPayloads).toContainEqual(firstPayload);
			expect(handledPayloads).toContainEqual(secondPayload);
			expect(await queue.getReceipt(secondDispatchId!)).toMatchObject({
				status: "completed",
			});
		});

		test("rolls back transactional publication when a short-policy conflict is not the same UUID replay", async () => {
			const transactionalAdapter = new PgBossAdapter({
				connectionString: databaseUrl!,
				schema: "pgboss_queue_secret_contract",
				useApplicationTransaction: true,
			});
			const transactionalQueue = createQueueClient(
				{ shortPolicy: shortPolicyJob },
				transactionalAdapter,
				{
					createContext: async () =>
						setup.app.createContext({
							accessMode: "system",
						}),
					getApp: () => setup.app,
					getDatabase: () => setup.app.db,
					secret: rootSecret,
					logger: {
						info: () => {},
						warn: () => {},
						error: () => {},
					},
				},
			);
			const firstKey = "invitation-mail:short-policy-transactional:first:v1";
			const secondKey = "invitation-mail:short-policy-transactional:second:v1";
			const secondDispatchId = await stableQueueDispatchId(
				"queue-secret-short-policy",
				secondKey,
			);

			try {
				const firstDispatchId = await withTransaction(setup.app.db, () =>
					transactionalQueue.shortPolicy.publish(
						{
							invitationId: "invitation-short-policy-transactional-first",
							rawSecret: "short-policy-transactional-first-secret",
						},
						{ idempotencyKey: firstKey, secretPayload: true },
					),
				);

				await expect(
					withTransaction(setup.app.db, () =>
						transactionalQueue.shortPolicy.publish(
							{
								invitationId: "invitation-short-policy-transactional-second",
								rawSecret: "short-policy-transactional-second-secret",
							},
							{ idempotencyKey: secondKey, secretPayload: true },
						),
					),
				).rejects.toThrow("QUESTPIE pg-boss publication was not accepted");
				expect(
					await transactionalQueue.getReceipt(secondDispatchId),
				).toBeNull();
				expect(
					await setup.app.db.execute(sql`
						SELECT id::text AS id
						FROM pgboss_queue_secret_contract.job
						WHERE id = ${secondDispatchId}::uuid
					`),
				).toEqual([]);

				await transactionalQueue.runOnce({
					jobs: ["queue-secret-short-policy"],
				});
				expect(
					await transactionalQueue.getReceipt(firstDispatchId!),
				).toMatchObject({ status: "completed" });

				await expect(
					withTransaction(setup.app.db, () =>
						transactionalQueue.shortPolicy.publish(
							{
								invitationId: "invitation-short-policy-transactional-second",
								rawSecret: "short-policy-transactional-second-secret",
							},
							{ idempotencyKey: secondKey, secretPayload: true },
						),
					),
				).resolves.toBe(secondDispatchId);
				await transactionalQueue.runOnce({
					jobs: ["queue-secret-short-policy"],
				});
				expect(
					await transactionalQueue.getReceipt(secondDispatchId),
				).toMatchObject({ status: "completed" });
			} finally {
				await transactionalQueue.stop();
			}
		});

		test("reconciles a later terminal secret dispatch beyond the first inspection batch", async () => {
			const dispatchIds: string[] = [];
			for (let index = 0; index < 3; index += 1) {
				const dispatchId = await withTransaction(setup.app.db, () =>
					queue.delivery.publish(
						{
							invitationId: `invitation-reconciliation-page-${index}`,
							rawSecret: `reconciliation-page-secret-${index}`,
						},
						{
							idempotencyKey: `invitation-mail:reconciliation-page-${index}:v1`,
							secretPayload: true,
						},
					),
				);
				dispatchIds.push(dispatchId!);
			}
			const [first, second, terminalId] = dispatchIds;
			expect(first).toBeDefined();
			expect(second).toBeDefined();
			expect(terminalId).toBeDefined();

			await setup.app.db.execute(sql`
				UPDATE pgboss_queue_secret_contract.job
				SET state = 'active', started_on = CURRENT_TIMESTAMP
				WHERE id IN (${first}::uuid, ${second}::uuid)
			`);
			await setup.app.db.execute(sql`
				UPDATE pgboss_queue_secret_contract.job
				SET state = 'failed', completed_on = CURRENT_TIMESTAMP
				WHERE id = ${terminalId}::uuid
			`);

			await expect(queue.drain({ batchSize: 2 })).resolves.toMatchObject({
				terminal: 1,
			});
			expect(await queue.getReceipt(first!)).toMatchObject({
				status: "queued",
			});
			expect(await queue.getReceipt(second!)).toMatchObject({
				status: "queued",
			});
			expect(await queue.getReceipt(terminalId!)).toMatchObject({
				status: "failed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, terminalId));
			expect(terminal?.wrappedSecretKey).toBeNull();
		});

		test("erases the data key when broker publication exhausts recovery", async () => {
			const rawSecret = "relay-terminal-raw-invitation-token";
			adapter.failNextPublications(25);
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-relay-terminal",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:relay-terminal:v1",
						secretPayload: true,
					},
				),
			);

			for (let attempt = 1; attempt < 25; attempt += 1) {
				await setup.app.db
					.update(questpieQueueDispatchTable)
					.set({ availableAt: new Date(0) })
					.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
				await queue.drain();
			}

			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "failed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(terminal).toMatchObject({
				status: "failed",
				attempts: 25,
				wrappedSecretKey: null,
				payload: null,
			});
			expect(JSON.stringify(terminal)).not.toContain(rawSecret);
			expect(JSON.stringify(terminal)).not.toContain(
				"injected broker publication failure",
			);
		});

		test("fails closed and erases the key when broker ciphertext is corrupted", async () => {
			const rawSecret = "tamper-raw-invitation-token";
			const dispatchId = await withTransaction(setup.app.db, () =>
				queue.delivery.publish(
					{
						invitationId: "invitation-tamper",
						rawSecret,
					},
					{
						idempotencyKey: "invitation-mail:tamper:v1",
						secretPayload: true,
					},
				),
			);
			await setup.app.db.execute(sql`
				UPDATE pgboss_queue_secret_contract.job
				SET data = jsonb_set(
					data,
					'{payload,__questpieQueueSecret,ciphertext}',
					'"tampered"'::jsonb
				)
				WHERE id = ${dispatchId}::uuid
			`);

			await expect(
				queue.runOnce({ jobs: ["queue-secret-delivery"] }),
			).rejects.toThrow("QUESTPIE Queue secret job handling failed");
			expect(await queue.getReceipt(dispatchId!)).toMatchObject({
				status: "failed",
			});
			const [terminal] = await setup.app.db
				.select()
				.from(questpieQueueDispatchTable)
				.where(eq(questpieQueueDispatchTable.dispatchId, dispatchId));
			expect(terminal?.wrappedSecretKey).toBeNull();
			expect(JSON.stringify(terminal)).not.toContain(rawSecret);
		});
	},
);
