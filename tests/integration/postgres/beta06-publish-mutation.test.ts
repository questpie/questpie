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
				expect(counts).toEqual({
					messages: 1,
					audit: 1,
					facts: 1,
					intents: 1,
					receipts: 1,
				});
				const [concurrentCounts] = await database!.unsafe<
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
					[concurrentCallId],
				);
				expect(concurrentCounts).toEqual({
					messages: 1,
					audit: 1,
					facts: 1,
					intents: 1,
					receipts: 1,
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
