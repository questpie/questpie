import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	prepareBeta08Durable,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const decoder = new TextDecoder();

afterAll(async () => {
	await database?.close();
});

async function publish(
	prepared: Beta08Harness,
	input: Readonly<{ body: string; callId: string }>,
): Promise<string> {
	return prepared.app.execution(
		{
			principal: prepared.principal,
			context: { companyId: beta05Ids.company },
		},
		async ({ mutations }) => {
			const message = await mutations["message.publish"](
				{ channelId: beta05Ids.channel, body: input.body },
				{ callId: input.callId },
			);
			return message.id;
		},
	);
}

async function runIdentity(callId: string): Promise<string> {
	const [row] = await database!.unsafe<readonly Readonly<{ runId: string }>[]>(
		`SELECT runs.run_id::text AS "runId"
FROM questpie_internal.durable_runs AS runs
JOIN questpie_internal.pending_reaction_intents AS intents
  ON intents.application_name = runs.application_name
 AND intents.record_id = runs.dispatch_id
WHERE runs.application_name = 'application:collaboration' AND intents.call_id = $1`,
		[callId],
	);
	expect(row?.runId).toBeString();
	return row!.runId;
}

async function deliveredEvents(messageId: string): Promise<number> {
	const [row] = await database!.unsafe<
		readonly Readonly<{ delivered: number }>[]
	>(
		`SELECT count(*)::int AS delivered FROM collaboration.message_events
WHERE message_id = $1 AND kind = 'delivered'`,
		[messageId],
	);
	return row?.delivered ?? 0;
}

postgresTest(
	"one committed publication creates one Reaction and a worker records a Policy-current result",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-worker-000-0000-000000000001";
			const messageId = await publish(prepared, {
				body: "one durable engine",
				callId,
			});
			const runId = await runIdentity(callId);
			expect((await prepared.kernel.inspect(runId))?.state).toBe("ready");

			const trace = await prepared.app.durable.poll();
			expect(trace).toMatchObject({
				admitted: 1,
				claimed: 1,
				refusedIncompatible: 0,
			});
			expect(trace.outcomes).toEqual([
				{
					runId,
					resource: "reaction:messagePublished",
					attemptNumber: 1,
					outcome: "succeeded",
					failureCode: null,
				},
			]);

			const view = await prepared.kernel.inspect(runId);
			expect(view).toMatchObject({
				state: "succeeded",
				attemptCount: 1,
				deadLetter: false,
				failureCode: null,
			});
			const result = JSON.parse(
				decoder.decode(view!.resultBytes!),
			) as Readonly<{
				deliveryReceipt: string;
				eventId: string;
				messageId: string;
			}>;
			expect(result.messageId).toBe(messageId);
			expect(result.deliveryReceipt).toStartWith("delivery:");

			const effects = await prepared.ledger.read(runId);
			expect(effects).toEqual([
				expect.objectContaining({
					effectName: "deliver-message",
					status: "succeeded",
					receipt: result.deliveryReceipt,
				}),
			]);
			expect(result.deliveryReceipt).toBe(`delivery:${effects[0]!.effectId}`);
			expect(await deliveredEvents(messageId)).toBe(1);

			expect(
				(await prepared.kernel.events(runId)).map(({ kind }) => kind),
			).toEqual(["accepted", "attemptStarted", "succeeded"]);

			// A terminal run is not admitted again, and the same committed fact
			// still owns exactly one run.
			const second = await prepared.app.durable.poll();
			expect(second).toMatchObject({ admitted: 0, claimed: 0 });
			await publish(prepared, { body: "one durable engine", callId });
			const [runs] = await database!.unsafe<
				readonly Readonly<{ runs: number }>[]
			>(`SELECT count(*)::int AS runs FROM questpie_internal.durable_runs`);
			expect(runs?.runs).toBe(1);
			expect(await deliveredEvents(messageId)).toBe(1);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);

postgresTest(
	"a definitely refused effect retries and the recovered attempt delivers exactly once",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-worker-000-0000-000000000002";
			const messageId = await publish(prepared, {
				body: "delivery-refused-once please",
				callId,
			});
			const runId = await runIdentity(callId);

			const first = await prepared.app.durable.poll();
			expect(first.outcomes).toEqual([
				expect.objectContaining({
					outcome: "retryScheduled",
					failureCode: "HANDLER_FAILED",
				}),
			]);
			expect(await prepared.kernel.inspect(runId)).toMatchObject({
				state: "delayed",
				attemptCount: 1,
				deadLetter: false,
			});
			expect(await prepared.ledger.read(runId)).toEqual([
				expect.objectContaining({
					effectName: "deliver-message",
					status: "pending",
					receipt: null,
				}),
			]);
			expect(await deliveredEvents(messageId)).toBe(0);

			await Bun.sleep(1_100);
			const second = await prepared.app.durable.poll();
			expect(second.outcomes).toEqual([
				expect.objectContaining({ outcome: "succeeded", attemptNumber: 2 }),
			]);
			expect(await prepared.kernel.inspect(runId)).toMatchObject({
				state: "succeeded",
				attemptCount: 2,
			});
			expect(await prepared.ledger.read(runId)).toEqual([
				expect.objectContaining({ status: "succeeded" }),
			]);
			expect(await deliveredEvents(messageId)).toBe(1);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);

postgresTest(
	"a lost provider response becomes an acknowledgeable ambiguity instead of a silent retry",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-worker-000-0000-000000000003";
			const messageId = await publish(prepared, {
				body: "delivery-lost response",
				callId,
			});
			const runId = await runIdentity(callId);

			const trace = await prepared.app.durable.poll();
			expect(trace.outcomes).toEqual([
				expect.objectContaining({
					outcome: "failed",
					failureCode: "EFFECT_AMBIGUOUS",
				}),
			]);
			expect(await prepared.kernel.inspect(runId)).toMatchObject({
				state: "failed",
				attemptCount: 1,
				deadLetter: true,
				failureCode: "EFFECT_AMBIGUOUS",
			});
			expect(await prepared.ledger.read(runId)).toEqual([
				expect.objectContaining({
					effectName: "deliver-message",
					status: "ambiguous",
					receipt: null,
				}),
			]);
			expect(await deliveredEvents(messageId)).toBe(0);

			const actor = { kind: "user", id: beta05Ids.principal } as const;
			expect(
				await prepared.maintenance.acknowledgeAmbiguity({
					runId,
					effectName: "deliver-message",
					actor,
				}),
			).toMatchObject({ outcome: "applied", rejectionCode: null });
			expect(await prepared.ledger.read(runId)).toEqual([
				expect.objectContaining({ status: "acknowledged" }),
			]);
			expect(
				await prepared.maintenance.acknowledgeAmbiguity({
					runId,
					effectName: "deliver-message",
					actor,
				}),
			).toMatchObject({ outcome: "rejected", rejectionCode: "NOT_AMBIGUOUS" });
			expect(
				(await prepared.kernel.events(runId)).map(({ kind }) => kind),
			).toEqual([
				"accepted",
				"attemptStarted",
				"failed",
				"ambiguityAcknowledged",
			]);
			const audit = await prepared.maintenance.audit(runId);
			expect(
				audit.map(({ command, outcome }) => `${command}:${outcome}`),
			).toEqual([
				"acknowledgeAmbiguity:applied",
				"acknowledgeAmbiguity:rejected",
			]);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);

postgresTest(
	"revoking the caller Membership makes the next attempt terminal with RUN_AS_DENIED",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-worker-000-0000-000000000004";
			const messageId = await publish(prepared, {
				body: "authority probe",
				callId,
			});
			const runId = await runIdentity(callId);
			await database!.unsafe(
				`UPDATE collaboration.memberships SET status = 'revoked' WHERE id = $1`,
				[beta05Ids.membership],
			);

			const trace = await prepared.app.durable.poll();
			expect(trace.outcomes).toEqual([
				expect.objectContaining({
					outcome: "failed",
					failureCode: "RUN_AS_DENIED",
				}),
			]);
			expect(await prepared.kernel.inspect(runId)).toMatchObject({
				state: "failed",
				attemptCount: 1,
				deadLetter: true,
				failureCode: "RUN_AS_DENIED",
			});
			expect(await prepared.ledger.read(runId)).toEqual([]);
			expect(await deliveredEvents(messageId)).toBe(0);

			// The run-as denial is permanent: an operator retry re-evaluates
			// current Policy rather than replaying the earlier decision.
			const actor = { kind: "user", id: beta05Ids.principal } as const;
			expect(
				await prepared.maintenance.retryRun({ runId, actor }),
			).toMatchObject({
				outcome: "applied",
				stateBefore: "failed",
				stateAfter: "ready",
			});
			const retried = await prepared.app.durable.poll();
			expect(retried.outcomes).toEqual([
				expect.objectContaining({
					outcome: "failed",
					failureCode: "RUN_AS_DENIED",
					attemptNumber: 2,
				}),
			]);

			await database!.unsafe(
				`UPDATE collaboration.memberships SET status = 'active' WHERE id = $1`,
				[beta05Ids.membership],
			);
			expect(
				await prepared.maintenance.retryRun({ runId, actor }),
			).toMatchObject({ outcome: "applied" });
			const recovered = await prepared.app.durable.poll();
			expect(recovered.outcomes).toEqual([
				expect.objectContaining({ outcome: "succeeded", attemptNumber: 3 }),
			]);
			expect(await deliveredEvents(messageId)).toBe(1);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);

postgresTest(
	"a declared Reaction error is permanent and creates a safe inspectable dead letter",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-worker-000-0000-000000000005";
			const messageId = await publish(prepared, {
				body: "declared error probe",
				callId,
			});
			const runId = await runIdentity(callId);
			await database!.unsafe(
				`DELETE FROM collaboration.message_events WHERE message_id = $1`,
				[messageId],
			);
			await database!.unsafe(
				`DELETE FROM collaboration.messages WHERE id = $1`,
				[messageId],
			);

			const trace = await prepared.app.durable.poll();
			expect(trace.outcomes).toEqual([
				expect.objectContaining({
					outcome: "failed",
					failureCode: "REACTION_ERROR",
				}),
			]);
			const view = await prepared.kernel.inspect(runId);
			expect(view).toMatchObject({
				state: "failed",
				attemptCount: 1,
				deadLetter: true,
				failureCode: "REACTION_ERROR",
				resultBytes: null,
			});
			const events = await prepared.kernel.events(runId);
			expect(events.at(-1)).toMatchObject({
				kind: "failed",
				errorCode: "REACTION_ERROR",
			});
			expect(
				events.every(
					(event) =>
						event.leaseTokenDigest === null ||
						/^[0-9a-f]{64}$/.test(event.leaseTokenDigest),
				),
			).toBe(true);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);
