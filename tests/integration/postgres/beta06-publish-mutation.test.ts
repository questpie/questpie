import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

type PublishedMessage = Readonly<{
	id: string;
	channelId: string;
	body: string;
	createdAt: Date;
}>;

afterAll(async () => {
	await database?.close({ timeout: 0 });
});

async function waitForBlockedChannelRead(): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const [blocked] = await database!.unsafe<
			Readonly<Array<{ blocked: boolean }>>
		>(`SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_stat_activity
  WHERE pid <> pg_catalog.pg_backend_pid()
    AND query LIKE '%FROM "collaboration"."channels"%FOR UPDATE%'
    AND pg_catalog.cardinality(pg_catalog.pg_blocking_pids(pid)) > 0
) AS blocked`);
		if (blocked?.blocked) return;
		await Bun.sleep(10);
	}
	throw new Error("Mutation did not reach the observable Channel lock wait");
}

async function mutationCounts(callId: string) {
	const [counts] = await database!.unsafe<
		Readonly<
			Array<{
				audit: number;
				intents: number;
				receipts: number;
			}>
		>
	>(
		`SELECT
  (SELECT count(*)::int FROM collaboration.message_events e
   JOIN questpie_internal.pending_reaction_intents i
     ON i.call_id = $1::text
    AND convert_from(i.payload_bytes, 'UTF8')::jsonb ->> 'messageId' = e.message_id::text) AS audit,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents WHERE call_id = $1::text) AS intents,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id = $1::text) AS receipts`,
		[callId],
	);
	return counts;
}

async function persistedMutationRows() {
	const [counts] = await database!.unsafe<
		Readonly<
			Array<{
				audit: number;
				intents: number;
				messages: number;
				receipts: number;
			}>
		>
	>(`SELECT
  (SELECT count(*)::int FROM collaboration.messages) AS messages,
  (SELECT count(*)::int FROM collaboration.message_events) AS audit,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents) AS intents,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts) AS receipts`);
	return counts;
}

async function changeLedgerTableCount(): Promise<number> {
	const [catalog] = await database!.unsafe<
		Readonly<Array<{ changeLedgerTables: number }>>
	>(`SELECT count(*)::int AS "changeLedgerTables"
FROM pg_catalog.pg_class relation
JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname IN ('collaboration', 'questpie_internal')
  AND relation.relkind IN ('r', 'p')
  AND relation.relname LIKE '%change%'`);
	return catalog?.changeLedgerTables ?? -1;
}

async function atomicBundle(callId: string, messageId: string) {
	return database!.unsafe<
		Readonly<
			Array<{
				applicationName: string;
				auditId: string;
				auditKind: string;
				auditRecordedAt: Date;
				auditTransactionId: string;
				committedAt: Date;
				dispatchSlot: string;
				intentRecordedAt: Date;
				intentTransactionId: string;
				messageAuthorMembershipId: string;
				messageCreatedAt: Date;
				messageTransactionId: string;
				operationTime: Date;
				outcome: string;
				payload: unknown;
				principalId: string;
				principalKind: string;
				reactionName: string;
				result: unknown;
				receiptTransactionId: string;
				receiptVersion: string;
				recordId: string;
				sourceOperation: string;
				state: string;
				tenantId: string;
			}>
		>
	>(
		`SELECT
  receipt.application_name AS "applicationName",
  event.id::text AS "auditId",
  event.kind AS "auditKind",
  event.occurred_at AS "auditRecordedAt",
  event.xmin::text AS "auditTransactionId",
  receipt.committed_at AS "committedAt",
  intent.dispatch_slot AS "dispatchSlot",
  intent.recorded_at AS "intentRecordedAt",
  intent.transaction_id::text AS "intentTransactionId",
  message.author_membership_id::text AS "messageAuthorMembershipId",
  message.created_at AS "messageCreatedAt",
  message.xmin::text AS "messageTransactionId",
  receipt.operation_time AS "operationTime",
  receipt.outcome,
  convert_from(intent.payload_bytes, 'UTF8')::jsonb AS payload,
  receipt.principal_id AS "principalId",
  receipt.principal_kind AS "principalKind",
  intent.reaction_name AS "reactionName",
  convert_from(receipt.result_bytes, 'UTF8')::jsonb AS result,
  receipt.transaction_id::text AS "receiptTransactionId",
  receipt.xmin::text AS "receiptVersion",
  intent.record_id::text AS "recordId",
  intent.source_operation AS "sourceOperation",
  intent.state,
  receipt.tenant_id AS "tenantId"
FROM questpie_internal.mutation_call_receipts receipt
JOIN questpie_internal.pending_reaction_intents intent
  ON intent.application_name = receipt.application_name
 AND intent.tenant_id = receipt.tenant_id
 AND intent.source_operation = receipt.operation_name
 AND intent.principal_kind = receipt.principal_kind
 AND intent.principal_id = receipt.principal_id
 AND intent.call_id = receipt.call_id
JOIN collaboration.messages message ON message.id = $2::uuid
JOIN collaboration.message_events event ON event.message_id = message.id
WHERE receipt.call_id = $1::text`,
		[callId, messageId],
	);
}

postgresTest(
	"runs against the exact declared supported PostgreSQL major",
	async () => {
		const [version] = await database!.unsafe<
			Readonly<Array<{ serverVersionNum: string }>>
		>(`SELECT current_setting('server_version_num') AS "serverVersionNum"`);
		const declared = process.env.QUESTPIE_POSTGRES_MAJOR;
		expect(declared).toMatch(/^(16|17|18)$/);
		expect(Math.trunc(Number(version?.serverVersionNum) / 10_000)).toBe(
			Number(declared),
		);
	},
);

postgresTest("installs no BETA-07 Change Ledger table", async () => {
	const prepared = await prepareBeta05PostgresApplication(database!);
	try {
		expect(await changeLedgerTableCount()).toBe(0);
	} finally {
		await prepared.dispose();
	}
});

postgresTest(
	"replays a response-lost message.publish call without duplicating its atomic bundle",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		try {
			const application = await prepared.generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
			});
			try {
				const internal = await prepared.generated.loadInternal();
				const user = prepared.generated.framework.principal.user({
					id: beta05Ids.principal,
				});
				const context = { companyId: beta05Ids.company };
				const callId = "publish:retry:one";
				const mutationInput = {
					channelId: beta05Ids.channel,
					body: "  one atomic publish  ",
				};
				let loseFirstResponse = true;
				const lossyClient = prepared.generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: async (request: Request) => {
						const response = await application.fetch(
							internal.bindIngressPrincipalForRequest(request, user),
						);
						if (loseFirstResponse) {
							loseFirstResponse = false;
							throw new Error("response lost after commit");
						}
						return response;
					},
				});
				await expect(
					lossyClient
						.withContext(context)
						.mutations["message.publish"](mutationInput, { callId }),
				).rejects.toThrow("response lost after commit");
				const replay = (await lossyClient
					.withContext(context)
					.mutations["message.publish"](mutationInput, {
						callId,
					})) as PublishedMessage;
				const directReplay = (await application.execution(
					{ principal: user, context },
					(
						scope: Readonly<{
							mutations: Readonly<
								Record<
									string,
									(
										input: unknown,
										options: Readonly<{ callId: string }>,
									) => Promise<unknown>
								>
							>;
						}>,
					) => scope.mutations["message.publish"]!(mutationInput, { callId }),
				)) as PublishedMessage;
				expect(replay).toEqual({
					id: expect.any(String),
					channelId: beta05Ids.channel,
					body: "one atomic publish",
					createdAt: expect.any(Date),
				});
				expect(directReplay).toEqual(replay);
				await expect(
					lossyClient
						.withContext(context)
						.mutations["message.publish"](
							{ ...mutationInput, body: "different canonical input" },
							{ callId },
						),
				).rejects.toMatchObject({
					code: "IDEMPOTENCY_CONFLICT",
					status: 409,
					payload: { callId },
				});

				const concurrentCallId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62a1";
				const concurrentInput = {
					channelId: beta05Ids.channel,
					body: "concurrent duplicate",
				};
				const concurrent = (await Promise.all([
					lossyClient
						.withContext(context)
						.mutations["message.publish"](concurrentInput, {
							callId: concurrentCallId,
						}),
					lossyClient
						.withContext(context)
						.mutations["message.publish"](concurrentInput, {
							callId: concurrentCallId,
						}),
				])) as readonly [PublishedMessage, PublishedMessage];
				expect(concurrent[1]).toEqual(concurrent[0]);

				const counts = await mutationCounts(callId);
				expect(counts).toEqual({
					audit: 1,
					intents: 1,
					receipts: 1,
				});
				const concurrentCounts = await mutationCounts(concurrentCallId);
				expect(concurrentCounts).toEqual({
					audit: 1,
					intents: 1,
					receipts: 1,
				});

				const bundles = await atomicBundle(callId, replay.id);
				expect(bundles).toHaveLength(1);
				const bundle = bundles[0]!;
				expect(bundle).toMatchObject({
					applicationName: "application:collaboration",
					auditId: expect.any(String),
					auditKind: "published",
					dispatchSlot: "messagePublished",
					messageAuthorMembershipId: beta05Ids.membership,
					outcome: "committed",
					payload: {
						companyId: beta05Ids.company,
						messageId: replay.id,
					},
					principalId: beta05Ids.principal,
					principalKind: "user",
					reactionName: "reaction:messagePublished",
					result: {
						id: replay.id,
						channelId: beta05Ids.channel,
						body: "one atomic publish",
						createdAt: replay.createdAt.toISOString(),
					},
					recordId: "e6b69be2-3b11-54b4-a08e-39eac72a9e1c",
					sourceOperation: "mutation:message.publish",
					state: "pending",
					tenantId: beta05Ids.company,
				});
				expect(bundle.recordId).not.toBe(replay.id);
				expect(bundle.messageTransactionId).toBe(bundle.receiptTransactionId);
				expect(bundle.auditTransactionId).toBe(bundle.receiptTransactionId);
				expect(bundle.intentTransactionId).toBe(bundle.receiptTransactionId);
				expect(bundle.receiptVersion).toBe(bundle.receiptTransactionId);
				expect(bundle.messageCreatedAt).toEqual(bundle.operationTime);
				expect(bundle.auditRecordedAt).toEqual(bundle.operationTime);
				expect(bundle.intentRecordedAt).toEqual(bundle.operationTime);
				expect(bundle.committedAt).toEqual(bundle.operationTime);

				const concurrentBundles = await atomicBundle(
					concurrentCallId,
					concurrent[0].id,
				);
				expect(concurrentBundles).toHaveLength(1);
				const concurrentBundle = concurrentBundles[0]!;
				expect(concurrentBundle.recordId).toMatch(
					/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
				);
				expect(concurrentBundle.recordId).not.toBe(bundle.recordId);
				expect(await persistedMutationRows()).toEqual({
					audit: 2,
					intents: 2,
					messages: 3,
					receipts: 2,
				});
				expect(await changeLedgerTableCount()).toBe(0);

				const constraintCallId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62a2";
				const beforeConstraint = await persistedMutationRows();
				await expect(
					lossyClient
						.withContext(context)
						.mutations["message.publish"](
							{ channelId: beta05Ids.channel, body: "   " },
							{ callId: constraintCallId },
						),
				).rejects.toMatchObject({ code: "INTERNAL" });
				expect(await persistedMutationRows()).toEqual(beforeConstraint);
				expect(await mutationCounts(constraintCallId)).toEqual({
					audit: 0,
					intents: 0,
					receipts: 0,
				});
			} finally {
				await application.close();
			}
		} finally {
			await prepared.dispose();
		}
	},
	30_000,
);

postgresTest(
	"rechecks current Membership after a Channel lock wait and rolls back every record",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		const blocker = await database!.reserve();
		try {
			const application = await prepared.generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
			});
			try {
				const internal = await prepared.generated.loadInternal();
				const user = prepared.generated.framework.principal.user({
					id: beta05Ids.principal,
				});
				const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62b0";
				const client = prepared.generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: (request: Request) =>
						application.fetch(
							internal.bindIngressPrincipalForRequest(request, user),
						),
				});
				await blocker.unsafe("BEGIN");
				await blocker.unsafe(
					"SELECT id FROM collaboration.channels WHERE id = $1 FOR UPDATE",
					[beta05Ids.channel],
				);
				const pending = client
					.withContext({ companyId: beta05Ids.company })
					.mutations["message.publish"](
						{ channelId: beta05Ids.channel, body: "must be revoked" },
						{ callId },
					);
				await waitForBlockedChannelRead();
				await database!.unsafe(
					"UPDATE collaboration.memberships SET status = 'inactive' WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'",
					[beta05Ids.company, beta05Ids.principal],
				);
				await blocker.unsafe("COMMIT");
				await expect(pending).rejects.toMatchObject({
					code: "CHANNEL_UNAVAILABLE",
					status: 404,
				});
				const counts = await mutationCounts(callId);
				expect(counts).toEqual({
					audit: 0,
					intents: 0,
					receipts: 0,
				});

				await database!.unsafe(
					"UPDATE collaboration.memberships SET status = 'active' WHERE company_id = $1 AND principal_id = $2 AND scope_key = 'company'",
					[beta05Ids.company, beta05Ids.principal],
				);
				await blocker.unsafe("BEGIN");
				await blocker.unsafe(
					"SELECT id FROM collaboration.channels WHERE id = $1 FOR UPDATE",
					[beta05Ids.channel],
				);
				const cancelledCallId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62b1";
				const controller = new AbortController();
				const cancelled = client
					.withContext({ companyId: beta05Ids.company })
					.mutations["message.publish"](
						{ channelId: beta05Ids.channel, body: "must roll back" },
						{ callId: cancelledCallId, signal: controller.signal },
					);
				await waitForBlockedChannelRead();
				controller.abort(new DOMException("caller cancelled", "AbortError"));
				await blocker.unsafe("COMMIT");
				await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
				expect(await mutationCounts(cancelledCallId)).toEqual({
					audit: 0,
					intents: 0,
					receipts: 0,
				});
			} finally {
				await blocker.unsafe("ROLLBACK").catch(() => {});
				await application.close();
			}
		} finally {
			await blocker.release();
			await prepared.dispose();
		}
	},
	30_000,
);

postgresTest(
	"omits a forbidden output Field and rolls back the complete candidate",
	async () => {
		const prepared = await prepareBeta05PostgresApplication(database!);
		try {
			await database!.unsafe(
				"UPDATE collaboration.memberships SET role = 'member' WHERE id = $1",
				[beta05Ids.membership],
			);
			const application = await prepared.generated.app.createApp({
				postgres: { url: beta05PostgresUrl() },
			});
			try {
				const internal = await prepared.generated.loadInternal();
				const user = prepared.generated.framework.principal.user({
					id: beta05Ids.principal,
				});
				const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62c0";
				const before = await persistedMutationRows();
				const client = prepared.generated.client.createClient({
					baseUrl: "http://runtime.test",
					fetch: (request: Request) =>
						application.fetch(
							internal.bindIngressPrincipalForRequest(request, user),
						),
				});
				await expect(
					client
						.withContext({ companyId: beta05Ids.company })
						.mutations["message.publish"](
							{ channelId: beta05Ids.channel, body: "must stay hidden" },
							{ callId },
						),
				).rejects.toMatchObject({
					code: "CHANNEL_UNAVAILABLE",
					status: 404,
				});
				expect(await persistedMutationRows()).toEqual(before);
				expect(await mutationCounts(callId)).toEqual({
					audit: 0,
					intents: 0,
					receipts: 0,
				});
			} finally {
				await application.close();
			}
		} finally {
			await prepared.dispose();
		}
	},
	30_000,
);
