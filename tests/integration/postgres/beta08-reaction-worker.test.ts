import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const decoder = new TextDecoder();

async function harness(): Promise<Beta08Harness> {
	return beta08Harness(database!);
}

afterAll(async () => {
	await disposeBeta08Harness();
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
			const message = await mutations.message.publish(
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

type WorkerTrace = Readonly<{
	outcomes: readonly Readonly<{
		runId: string;
		resource: string;
		attemptNumber: number;
		outcome: string;
		failureCode: string | null;
	}>[];
}>;

/**
 * One application serves every test in this file, so a poll admits whatever is
 * ready. Each case reads exactly the outcome for the run it published.
 */
function outcomeFor(
	trace: WorkerTrace,
	runId: string,
): WorkerTrace["outcomes"][number] {
	const outcomes = trace.outcomes.filter((outcome) => outcome.runId === runId);
	expect(outcomes).toHaveLength(1);
	return outcomes[0]!;
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
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000001";
		const messageId = await publish(prepared, {
			body: "one durable engine",
			callId,
		});
		const runId = await runIdentity(callId);
		expect((await prepared.kernel.inspect(runId))?.state).toBe("ready");

		const trace = await prepared.app.durable.poll();
		expect(trace).toMatchObject({ refusedIncompatible: 0 });
		expect(outcomeFor(trace, runId)).toEqual({
			runId,
			resource: "reaction:messagePublished",
			attemptNumber: 1,
			outcome: "succeeded",
			failureCode: null,
		});

		const view = await prepared.kernel.inspect(runId);
		expect(view).toMatchObject({
			state: "succeeded",
			attemptCount: 1,
			deadLetter: false,
			failureCode: null,
		});
		const result = JSON.parse(decoder.decode(view!.resultBytes!)) as Readonly<{
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
		).toEqual(["accepted", "attemptStarted", "effectSettled", "succeeded"]);

		// A terminal run is not admitted again, and the same committed fact
		// still owns exactly one run.
		const second = await prepared.app.durable.poll();
		expect(second.outcomes.some((outcome) => outcome.runId === runId)).toBe(
			false,
		);
		await publish(prepared, { body: "one durable engine", callId });
		const [runs] = await database!.unsafe<
			readonly Readonly<{ runs: number }>[]
		>(`SELECT count(*)::int AS runs FROM questpie_internal.durable_runs`);
		expect(runs?.runs).toBe(1);
		expect(await deliveredEvents(messageId)).toBe(1);
	},
	180_000,
);

postgresTest(
	"a definitely refused effect retries and the recovered attempt delivers exactly once",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000002";
		const messageId = await publish(prepared, {
			body: "delivery-refused-once please",
			callId,
		});
		const runId = await runIdentity(callId);

		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "retryScheduled",
			failureCode: "HANDLER_FAILED",
		});
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
		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "succeeded",
			attemptNumber: 2,
		});
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "succeeded",
			attemptCount: 2,
		});
		expect(await prepared.ledger.read(runId)).toEqual([
			expect.objectContaining({ status: "succeeded" }),
		]);
		expect(await deliveredEvents(messageId)).toBe(1);
	},
	180_000,
);

postgresTest(
	"a lost provider response becomes an acknowledgeable ambiguity instead of a silent retry",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000003";
		const messageId = await publish(prepared, {
			body: "delivery-lost response",
			callId,
		});
		const runId = await runIdentity(callId);

		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "EFFECT_AMBIGUOUS",
		});
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

		const actor = prepared.principal;
		expect(
			await prepared.maintenance.acknowledgeAmbiguity({
				runId,
				effectName: "deliver-message",
				reason: "operator acknowledged ambiguous delivery",
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
				reason: "duplicate acknowledgement probe",
				actor,
			}),
		).toMatchObject({ outcome: "rejected", rejectionCode: "NOT_AMBIGUOUS" });
		expect(
			(await prepared.kernel.events(runId)).map(({ kind }) => kind),
		).toEqual([
			"accepted",
			"attemptStarted",
			"effectAmbiguous",
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
	},
	180_000,
);

postgresTest(
	"revoking the caller Membership makes the next attempt terminal with RUN_AS_DENIED",
	async () => {
		const prepared = await harness();
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

		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "RUN_AS_DENIED",
		});
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
		const actor = prepared.principal;
		expect(
			await prepared.maintenance.retryRun({
				runId,
				reason: "policy restored retry",
				actor,
			}),
		).toMatchObject({
			outcome: "applied",
			stateBefore: "failed",
			stateAfter: "ready",
		});
		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "RUN_AS_DENIED",
			attemptNumber: 2,
		});

		await database!.unsafe(
			`UPDATE collaboration.memberships SET status = 'active' WHERE id = $1`,
			[beta05Ids.membership],
		);
		expect(
			await prepared.maintenance.retryRun({
				runId,
				reason: "active membership retry",
				actor,
			}),
		).toMatchObject({ outcome: "applied" });
		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "succeeded",
			attemptNumber: 3,
		});
		expect(await deliveredEvents(messageId)).toBe(1);
	},
	180_000,
);

postgresTest(
	"a declared Reaction error is permanent and creates a safe inspectable dead letter",
	async () => {
		const prepared = await harness();
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
		await database!.unsafe(`DELETE FROM collaboration.messages WHERE id = $1`, [
			messageId,
		]);

		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "REACTION_ERROR",
		});
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
	},
	180_000,
);

postgresTest(
	"a reliable lookup recovers a lost response and a later attempt reuses the settled receipt",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000006";
		const messageId = await publish(prepared, {
			body: "delivery-recovered after loss",
			callId,
		});
		const runId = await runIdentity(callId);

		// The provider accepted the request and then lost its response; the
		// lookup contract resolves it inside the same attempt.
		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "succeeded",
			attemptNumber: 1,
		});
		const effects = await prepared.ledger.read(runId);
		expect(effects).toEqual([
			expect.objectContaining({
				effectName: "deliver-message",
				status: "succeeded",
			}),
		]);
		const recovered = effects[0]!;
		expect(recovered.receipt).toBe(`delivery:${recovered.effectId}`);
		expect(await deliveredEvents(messageId)).toBe(1);
	},
	180_000,
);

postgresTest(
	"a result outside its byte budget fails permanently with RESOURCE_LIMIT",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000007";
		const messageId = await publish(prepared, {
			body: "oversized result",
			callId,
		});
		const runId = await runIdentity(callId);
		const trace = await prepared.app.durable.poll({
			workerId: "worker:bounded-result",
			resultBytesLimit: 8,
		});
		expect(outcomeFor(trace, runId)).toMatchObject({
			outcome: "failed",
			failureCode: "RESOURCE_LIMIT",
		});
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "failed",
			attemptCount: 1,
			deadLetter: true,
			failureCode: "RESOURCE_LIMIT",
			resultBytes: null,
		});
		// The bounded result never reaches application state, but the effect the
		// handler already performed stays recorded.
		expect(await deliveredEvents(messageId)).toBe(1);
		expect(await prepared.ledger.read(runId)).toEqual([
			expect.objectContaining({ status: "succeeded" }),
		]);
	},
	180_000,
);

postgresTest(
	"the server-only Mutation the Reaction calls is refused on the network wire",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000008";
		const messageId = await publish(prepared, {
			body: "server only recording",
			callId,
		});

		// `message.recordDelivery` has an Operation contract, so the engine can
		// prepare it for the Reaction, but it is absent from the network wire.
		const forged = prepared.wireFrame("mutation:message.recordDelivery", {
			messageId,
		});
		const response = await prepared.fetch(
			prepared.bindPrincipal(
				new Request("http://runtime.test/_questpie/operation", {
					method: "POST",
					headers: { "content-type": forged.mediaType },
					body: forged.body,
				}),
			),
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toMatchObject({
			kind: "failure",
			error: { code: "NOT_FOUND" },
		});
		expect(await deliveredEvents(messageId)).toBe(0);

		// The network Mutation on the same wire still answers, so the refusal is
		// about exposure rather than a broken Fetch path.
		const allowed = prepared.wireFrame("mutation:message.publish", {
			channelId: beta05Ids.channel,
			body: "network publish",
		});
		const published = await prepared.fetch(
			prepared.bindPrincipal(
				new Request("http://runtime.test/_questpie/operation", {
					method: "POST",
					headers: { "content-type": allowed.mediaType },
					body: allowed.body,
				}),
			),
		);
		expect(published.status).toBe(200);

		// The Reaction reaches the same server-only Mutation through ctx.
		const runId = await runIdentity(callId);
		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "succeeded",
		});
		expect(await deliveredEvents(messageId)).toBe(1);
	},
	180_000,
);

postgresTest(
	"reusing one effect identity with different canonical input is a permanent conflict",
	async () => {
		const prepared = await harness();
		const callId = "beta08-worker-000-0000-000000000009";
		await publish(prepared, { body: "effect conflict", callId });
		const runId = await runIdentity(callId);

		// An earlier attempt settled this run's effect under different canonical
		// input; the handler's own invocation must not silently reuse it.
		const claimed = await prepared.kernel.claim({
			runId,
			workerId: "worker:conflict",
			leaseMilliseconds: 1_000,
			attemptDeadlineMilliseconds: 1_000,
		});
		if (claimed.status !== "claimed") throw new Error("claim failed");
		expect(
			await prepared.ledger.reserve(claimed.claim, {
				effectName: "deliver-message",
				input: { messageId: runId },
			}),
		).toMatchObject({ status: "reserved" });
		await Bun.sleep(1_200);

		expect(outcomeFor(await prepared.app.durable.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "EFFECT_CONFLICT",
			attemptNumber: 2,
		});
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "failed",
			deadLetter: true,
			failureCode: "EFFECT_CONFLICT",
		});
	},
	180_000,
);
