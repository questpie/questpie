import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	beta05PostgresUrl,
	prepareBeta05PostgresApplication,
} from "./helpers/beta05-runtime";

const database = process.env.PGHOST ? new SQL({ max: 2 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

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
				messages: number;
				audit: number;
				facts: number;
				intents: number;
				receipts: number;
			}>
		>
	>(
		`SELECT
  (SELECT count(*)::int FROM collaboration.messages WHERE id = $1) AS messages,
  (SELECT count(*)::int FROM collaboration.message_events WHERE message_id = $1) AS audit,
  (SELECT count(*)::int FROM questpie_internal.committed_change_facts WHERE call_id = $1) AS facts,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents WHERE call_id = $1) AS intents,
  (SELECT count(*)::int FROM questpie_internal.mutation_call_receipts WHERE call_id = $1) AS receipts`,
		[callId],
	);
	return counts;
}

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
				const callId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62a0";
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
				const replay = await lossyClient
					.withContext(context)
					.mutations["message.publish"](mutationInput, { callId });
				const directReplay = await application.execution(
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
				);
				expect(replay).toEqual({
					id: callId,
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
				const concurrent = await Promise.all([
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
				]);
				expect(concurrent[1]).toEqual(concurrent[0]);

				const counts = await mutationCounts(callId);
				expect(counts).toEqual({
					messages: 1,
					audit: 1,
					facts: 1,
					intents: 1,
					receipts: 1,
				});
				const concurrentCounts = await mutationCounts(concurrentCallId);
				expect(concurrentCounts).toEqual({
					messages: 1,
					audit: 1,
					facts: 1,
					intents: 1,
					receipts: 1,
				});
				const constraintCallId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b62a2";
				await expect(
					lossyClient
						.withContext(context)
						.mutations["message.publish"](
							{ channelId: beta05Ids.channel, body: "   " },
							{ callId: constraintCallId },
						),
				).rejects.toMatchObject({ code: "INTERNAL" });
				expect(await mutationCounts(constraintCallId)).toEqual({
					messages: 0,
					audit: 0,
					facts: 0,
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
	"rechecks current Membership after a Channel lock wait and rolls back every fact",
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
					messages: 0,
					audit: 0,
					facts: 0,
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
					messages: 0,
					audit: 0,
					facts: 0,
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
