import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	createDurableReactionWorker,
	createDurableRunHandle,
	linkReactionProjection,
} from "../../../packages/runtime/src/index";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
	retiredDurableKernel,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const encoder = new TextEncoder();

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
			const message = await mutations["message.publish"](
				{ channelId: beta05Ids.channel, body: input.body },
				{ callId: input.callId },
			);
			return message.id;
		},
	);
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

/**
 * A worker polls for admission rather than timing a stopwatch: an expired
 * lease becomes claimable at the moment PostgreSQL sees it, and a concurrent
 * writer on the same row makes `SKIP LOCKED` skip one attempt.
 */
async function claimAfterLeaseExpiry(
	kernel: Beta08Harness["kernel"],
	input: Readonly<{ runId: string; workerId: string }>,
): Promise<Awaited<ReturnType<Beta08Harness["kernel"]["claim"]>>> {
	const deadline = Date.now() + 5_000;
	for (;;) {
		const outcome = await kernel.claim(input);
		if (outcome.status === "claimed" || Date.now() > deadline) return outcome;
		await Bun.sleep(50);
	}
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

postgresTest(
	"a worker crash after claim cannot let the stale lease holder publish a terminal transition, and one fact keeps one Reaction",
	async () => {
		const prepared = await harness();
		const callId = "beta08-fence-0000-0000-000000000001";
		await publish(prepared, { body: "fence probe", callId });

		const runId = await runIdentity(callId);
		const [dispatchCount] = await database!.unsafe<
			readonly Readonly<{ runs: number; intents: number }>[]
		>(
			`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs AS runs
    JOIN questpie_internal.pending_reaction_intents AS intents
      ON intents.application_name = runs.application_name
     AND intents.record_id = runs.dispatch_id
   WHERE intents.call_id = $1) AS runs,
  (SELECT count(*)::int FROM questpie_internal.pending_reaction_intents WHERE call_id = $1) AS intents`,
			[callId],
		);
		expect(dispatchCount).toEqual({ runs: 1, intents: 1 });

		// One worker claims and commits, then crashes before any terminal
		// transition: nothing else runs on its behalf.
		const crashed = await prepared.kernel.claim({
			runId,
			workerId: "worker:crashed",
			leaseMilliseconds: 1_000,
			attemptDeadlineMilliseconds: 1_000,
		});
		expect(crashed.status).toBe("claimed");
		if (crashed.status !== "claimed") throw new Error("claim did not happen");
		expect(crashed.claim.attemptNumber).toBe(1);

		// A second worker cannot take the run over while the lease is held.
		expect(
			await prepared.kernel.claim({ runId, workerId: "worker:early" }),
		).toEqual({ status: "skipped" });

		// The lease expires and a fresh worker takes the run over.
		await Bun.sleep(1_200);
		const recovered = await claimAfterLeaseExpiry(prepared.kernel, {
			runId,
			workerId: "worker:recovered",
		});
		expect(recovered.status).toBe("claimed");
		if (recovered.status !== "claimed")
			throw new Error("takeover did not happen");
		expect(recovered.claim.attemptNumber).toBe(2);
		expect(recovered.claim.attemptId).not.toBe(crashed.claim.attemptId);
		expect(recovered.claim.leaseToken).not.toBe(crashed.claim.leaseToken);

		// The stale holder wakes up and tries to publish success.
		const stale = await prepared.kernel.succeed(
			crashed.claim,
			encoder.encode("{}"),
		);
		expect(stale).toEqual({
			status: "fenced",
			state: null,
			deadLetter: false,
		});

		const afterStale = await prepared.kernel.inspect(runId);
		expect(afterStale?.state).toBe("running");
		expect(afterStale?.currentAttemptId).toBe(recovered.claim.attemptId);

		// Every other stale transition is fenced by the same compare-and-set.
		expect(
			await prepared.kernel.fail(crashed.claim, { code: "HANDLER_FAILED" }),
		).toMatchObject({ status: "fenced" });
		expect(await prepared.kernel.cancel(crashed.claim)).toMatchObject({
			status: "fenced",
		});
		expect(await prepared.kernel.heartbeat(crashed.claim)).toMatchObject({
			status: "fenced",
		});

		// The fresh holder completes the run exactly once.
		expect(
			await prepared.kernel.succeed(recovered.claim, encoder.encode("{}")),
		).toEqual({ status: "applied", state: "succeeded", deadLetter: false });

		const [counts] = await database!.unsafe<
			readonly Readonly<{
				runs: number;
				attempts: number;
				terminals: number;
			}>[]
		>(
			`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE run_id = $1) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts WHERE run_id = $1) AS attempts,
  (SELECT count(*)::int FROM questpie_internal.durable_run_events
    WHERE run_id = $1 AND kind IN ('cancelled', 'failed', 'succeeded')) AS terminals`,
			[runId],
		);
		expect(counts).toEqual({ runs: 1, attempts: 2, terminals: 1 });

		expect(
			(await prepared.kernel.events(runId)).map(({ kind }) => kind),
		).toEqual([
			"accepted",
			"attemptStarted",
			"leaseSuperseded",
			"attemptStarted",
			"succeeded",
		]);
		const [outcomes] = await database!.unsafe<
			readonly Readonly<{ outcomes: string }>[]
		>(
			`SELECT string_agg(outcome, ',' ORDER BY attempt_number) AS outcomes
FROM questpie_internal.durable_attempts WHERE run_id = $1`,
			[runId],
		);
		expect(outcomes?.outcomes).toBe("leaseSuperseded,succeeded");
	},
	120_000,
);

postgresTest(
	"concurrent SKIP LOCKED claims hand one ready run to exactly one worker",
	async () => {
		const prepared = await harness();
		const callId = "beta08-race-00000-0000-000000000002";
		await publish(prepared, { body: "claim race", callId });
		const runId = await runIdentity(callId);
		const contenders = await Promise.all(
			["worker:a", "worker:b", "worker:c", "worker:d"].map((workerId) =>
				prepared.kernel.claim({ runId, workerId }),
			),
		);
		expect(
			contenders.filter(({ status }) => status === "claimed"),
		).toHaveLength(1);
		expect(
			contenders.filter(({ status }) => status === "skipped"),
		).toHaveLength(3);
		const [attempts] = await database!.unsafe<
			readonly Readonly<{ attempts: number }>[]
		>(
			`SELECT count(*)::int AS attempts FROM questpie_internal.durable_attempts WHERE run_id = $1`,
			[runId],
		);
		expect(attempts?.attempts).toBe(1);
		expect((await prepared.kernel.inspect(runId))?.attemptCount).toBe(1);
	},
	120_000,
);

postgresTest(
	"retry exhaustion ends in one dead letter and never defers past the run horizon",
	async () => {
		// Full jitter draws uniformly from [0, cap); this run takes the lower
		// bound of its own declared distribution so the tracer stays bounded.
		const prepared = await harness();
		const kernel = prepared.kernelWith({ random: () => 0 });
		const callId = "beta08-retry-0000-0000-000000000003";
		await publish(prepared, { body: "retry program", callId });
		const runId = await runIdentity(callId);
		const states: string[] = [];
		for (let attempt = 1; attempt <= 8; attempt += 1) {
			const claimed = await kernel.claim({
				runId,
				workerId: `worker:retry-${attempt}`,
			});
			expect(claimed.status).toBe("claimed");
			if (claimed.status !== "claimed") throw new Error("claim failed");
			expect(claimed.claim.attemptNumber).toBe(attempt);
			const transition = await kernel.fail(claimed.claim, {
				code: "HANDLER_FAILED",
			});
			states.push(String(transition.state));
			if (attempt < 8) {
				const [horizon] = await database!.unsafe<
					readonly Readonly<{ withinHorizon: boolean }>[]
				>(
					`SELECT available_at <= horizon_at AS "withinHorizon"
FROM questpie_internal.durable_runs WHERE run_id = $1`,
					[runId],
				);
				expect(horizon?.withinHorizon).toBe(true);
			}
		}
		expect(states).toEqual([
			"delayed",
			"delayed",
			"delayed",
			"delayed",
			"delayed",
			"delayed",
			"delayed",
			"failed",
		]);
		const view = await prepared.kernel.inspect(runId);
		expect(view).toMatchObject({
			state: "failed",
			attemptCount: 8,
			deadLetter: true,
			failureCode: "RETRY_EXHAUSTED",
		});
		expect(
			await prepared.kernel.claim({ runId, workerId: "worker:after" }),
		).toEqual({ status: "skipped" });
		const kinds = (await prepared.kernel.events(runId)).map(({ kind }) => kind);
		expect(kinds.filter((kind) => kind === "retryScheduled")).toHaveLength(7);
		expect(kinds.filter((kind) => kind === "failed")).toHaveLength(1);
	},
	180_000,
);

postgresTest(
	"a cancellation request during a handler competes with success through one fenced transition",
	async () => {
		const prepared = await harness();
		const callId = "beta08-cancel-000-0000-000000000004";
		await publish(prepared, { body: "cancel race", callId });
		const runId = await runIdentity(callId);
		const claimed = await prepared.kernel.claim({
			runId,
			workerId: "worker:cancel",
		});
		if (claimed.status !== "claimed") throw new Error("claim failed");

		const requested = await prepared.maintenance.cancelRun({
			runId,
			reason: "operator stopped the run",
			actor: prepared.principal,
		});
		expect(requested).toMatchObject({
			outcome: "applied",
			stateBefore: "running",
			stateAfter: "running",
		});
		expect(await prepared.kernel.heartbeat(claimed.claim)).toMatchObject({
			status: "held",
			cancellationRequested: true,
		});

		const [succeeded, cancelled] = await Promise.all([
			prepared.kernel.succeed(claimed.claim, encoder.encode("{}")),
			prepared.kernel.cancel(claimed.claim),
		]);
		const applied = [succeeded, cancelled].filter(
			({ status }) => status === "applied",
		);
		const fenced = [succeeded, cancelled].filter(
			({ status }) => status === "fenced",
		);
		expect(applied).toHaveLength(1);
		expect(fenced).toHaveLength(1);
		const view = await prepared.kernel.inspect(runId);
		const winnerState = applied[0]!.state!;
		expect(["cancelled", "succeeded"]).toContain(winnerState);
		expect(view?.state).toBe(winnerState);
		const [terminals] = await database!.unsafe<
			readonly Readonly<{ terminals: number }>[]
		>(
			`SELECT count(*)::int AS terminals FROM questpie_internal.durable_run_events
WHERE run_id = $1 AND kind IN ('cancelled', 'failed', 'succeeded')`,
			[runId],
		);
		expect(terminals?.terminals).toBe(1);
	},
	120_000,
);

postgresTest(
	"a worker without compatible executable bytes refuses the claim instead of consuming an attempt",
	async () => {
		const prepared = await harness();
		const callId = "beta08-retire-000-0000-000000000005";
		await publish(prepared, { body: "executable retirement", callId });
		const runId = await runIdentity(callId);
		const retired = retiredDurableKernel(
			database!,
			prepared.reactionProjectionBytes,
		);
		expect(await retired.claim({ runId, workerId: "worker:retired" })).toEqual({
			status: "refused",
			code: "EXECUTABLE_RETIRED",
		});
		const admissions = await retired.admit();
		expect(admissions.map(({ runId: candidate }) => candidate)).toContain(
			runId,
		);
		const view = await prepared.kernel.inspect(runId);
		expect(view).toMatchObject({ state: "ready", attemptCount: 0 });
		const claimed = await prepared.kernel.claim({
			runId,
			workerId: "worker:current",
		});
		expect(claimed.status).toBe("claimed");
	},
	120_000,
);

postgresTest(
	"a cancel-requested run is reaped instead of starting a needless recovered attempt",
	async () => {
		const prepared = await harness();
		const callId = "beta08-reap-00000-0000-000000000007";
		await publish(prepared, { body: "cancel after crash", callId });
		const runId = await runIdentity(callId);
		const crashed = await prepared.kernel.claim({
			runId,
			workerId: "worker:reap-crashed",
			leaseMilliseconds: 1_000,
			attemptDeadlineMilliseconds: 1_000,
		});
		if (crashed.status !== "claimed") throw new Error("claim failed");

		expect(
			await prepared.maintenance.cancelRun({
				runId,
				reason: "operator stopped the run",
				actor: prepared.principal,
			}),
		).toMatchObject({ outcome: "applied", stateAfter: "running" });

		// The holder never returns and its lease expires. Nothing may start a
		// second attempt on a run whose cancellation is already durable.
		await Bun.sleep(1_200);
		expect(
			(await prepared.kernel.admit()).some(
				(admission) => admission.runId === runId,
			),
		).toBe(false);
		expect(
			await prepared.kernel.claim({ runId, workerId: "worker:reap-fresh" }),
		).toEqual({ status: "skipped" });

		expect(await prepared.kernel.reapCancelled()).toBe(1);
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "cancelled",
			attemptCount: 1,
			currentAttemptId: null,
		});
		const [attempts] = await database!.unsafe<
			readonly Readonly<{ attempts: number; cancelled: number }>[]
		>(
			`SELECT count(*)::int AS attempts,
       count(*) FILTER (WHERE outcome = 'cancelled')::int AS cancelled
FROM questpie_internal.durable_attempts WHERE run_id = $1`,
			[runId],
		);
		expect(attempts).toEqual({ attempts: 1, cancelled: 1 });
		expect(
			await prepared.kernel.succeed(crashed.claim, encoder.encode("{}")),
		).toMatchObject({ status: "fenced" });
		expect(await prepared.kernel.reapCancelled()).toBe(0);
	},
	120_000,
);

postgresTest(
	"each maintenance command elects one winner from a state that admits it",
	async () => {
		const prepared = await harness();
		const actor = prepared.principal;

		// cancelRun races on a genuinely running run.
		const runningCall = "beta08-command-00-0000-000000000006";
		await publish(prepared, {
			body: "maintenance running",
			callId: runningCall,
		});
		const runningRun = await runIdentity(runningCall);
		const claimed = await prepared.kernel.claim({
			runId: runningRun,
			workerId: "worker:maintenance",
		});
		expect(claimed.status).toBe("claimed");
		const cancels = await Promise.all([
			prepared.maintenance.cancelRun({
				runId: runningRun,
				reason: "left",
				actor,
			}),
			prepared.maintenance.cancelRun({
				runId: runningRun,
				reason: "right",
				actor,
			}),
		]);
		expect(cancels.filter(({ outcome }) => outcome === "applied")).toHaveLength(
			1,
		);
		expect(
			cancels.filter(
				({ outcome, rejectionCode }) =>
					outcome === "rejected" && rejectionCode === "ALREADY_REQUESTED",
			),
		).toHaveLength(1);
		const [cancellations] = await database!.unsafe<
			readonly Readonly<{ requests: number }>[]
		>(
			`SELECT count(*)::int AS requests FROM questpie_internal.durable_cancellations WHERE run_id = $1`,
			[runningRun],
		);
		expect(cancellations?.requests).toBe(1);

		// acknowledgeAmbiguity and retryRun race on a genuinely failed run whose
		// effect is genuinely ambiguous.
		const failedCall = "beta08-command-00-0000-000000000008";
		await publish(prepared, {
			body: "delivery-lost maintenance",
			callId: failedCall,
		});
		const failedRun = await runIdentity(failedCall);
		await prepared.app.durable.poll();
		expect(await prepared.kernel.inspect(failedRun)).toMatchObject({
			state: "failed",
			failureCode: "EFFECT_AMBIGUOUS",
		});
		expect(await prepared.ledger.read(failedRun)).toEqual([
			expect.objectContaining({ status: "ambiguous" }),
		]);

		const acknowledgements = await Promise.all([
			prepared.maintenance.acknowledgeAmbiguity({
				runId: failedRun,
				effectName: "deliver-message",
				reason: "settle ambiguous delivery",
				actor,
			}),
			prepared.maintenance.acknowledgeAmbiguity({
				runId: failedRun,
				effectName: "deliver-message",
				reason: "concurrent settlement probe",
				actor,
			}),
		]);
		expect(
			acknowledgements.filter(({ outcome }) => outcome === "applied"),
		).toHaveLength(1);
		expect(
			acknowledgements.filter(
				({ outcome, rejectionCode }) =>
					outcome === "rejected" && rejectionCode === "NOT_AMBIGUOUS",
			),
		).toHaveLength(1);

		const retries = await Promise.all([
			prepared.maintenance.retryRun({
				runId: failedRun,
				reason: "operator retry",
				actor,
			}),
			prepared.maintenance.retryRun({
				runId: failedRun,
				reason: "concurrent retry probe",
				actor,
			}),
		]);
		expect(retries.filter(({ outcome }) => outcome === "applied")).toHaveLength(
			1,
		);
		expect(
			retries.filter(
				({ outcome, rejectionCode }) =>
					outcome === "rejected" && rejectionCode === "RUN_NOT_FAILED",
			),
		).toHaveLength(1);
		const retried = await prepared.kernel.inspect(failedRun);
		expect(retried).toMatchObject({
			state: "ready",
			deadLetter: false,
			failureCode: null,
			terminalAt: null,
		});

		// Racing commands share a transaction timestamp, so the audit records
		// every attempt but fixes no order between the two contenders.
		const audit = await prepared.maintenance.audit(failedRun);
		expect(
			audit.map(({ command, outcome }) => `${command}:${outcome}`).sort(),
		).toEqual([
			"acknowledgeAmbiguity:applied",
			"acknowledgeAmbiguity:rejected",
			"retryRun:applied",
			"retryRun:rejected",
		]);
		expect(
			audit.every(
				({ actor: recorded }) =>
					recorded.kind === "user" && recorded.id === beta05Ids.principal,
			),
		).toBe(true);
	},
	180_000,
);

postgresTest(
	"one logical effect keeps one identity across attempts and the next attempt recovers its receipt",
	async () => {
		const prepared = await harness();
		const callId = "beta08-effect-000-0000-000000000009";
		await publish(prepared, { body: "stable effect identity", callId });
		const runId = await runIdentity(callId);

		const first = await prepared.kernel.claim({
			runId,
			workerId: "worker:effect-first",
			leaseMilliseconds: 1_000,
			attemptDeadlineMilliseconds: 1_000,
		});
		if (first.status !== "claimed") throw new Error("claim failed");
		let performed = 0;
		const firstHandle = createDurableRunHandle({
			ledger: prepared.ledger,
			claim: first.claim,
			declaredEffects: ["deliver-message"],
			signal: new AbortController().signal,
		});
		const receipt = await firstHandle.effect("deliver-message").invoke({
			input: { messageId: runId },
			perform: async ({ effectId }): Promise<`delivery:${string}`> => {
				performed += 1;
				return `delivery:${effectId}`;
			},
		});
		expect(performed).toBe(1);

		// The holder never publishes a terminal transition; a fresh worker takes
		// the run over after the lease expires.
		await Bun.sleep(1_200);
		const second = await claimAfterLeaseExpiry(prepared.kernel, {
			runId,
			workerId: "worker:effect-second",
		});
		if (second.status !== "claimed") throw new Error("takeover failed");
		expect(second.claim.attemptNumber).toBe(2);

		const secondHandle = createDurableRunHandle({
			ledger: prepared.ledger,
			claim: second.claim,
			declaredEffects: ["deliver-message"],
			signal: new AbortController().signal,
		});
		const recovered = await secondHandle.effect("deliver-message").invoke({
			input: { messageId: runId },
			perform: async (): Promise<`delivery:${string}`> => {
				performed += 1;
				return "delivery:second-call";
			},
		});
		expect(recovered).toBe(receipt);
		expect(performed).toBe(1);

		const effects = await prepared.ledger.read(runId);
		expect(effects).toHaveLength(1);
		expect(effects[0]).toMatchObject({
			effectName: "deliver-message",
			status: "succeeded",
			receipt,
		});
		expect(receipt).toBe(`delivery:${effects[0]!.effectId}`);

		// Reusing that identity with different canonical input conflicts.
		await expect(
			createDurableRunHandle({
				ledger: prepared.ledger,
				claim: second.claim,
				declaredEffects: ["deliver-message"],
				signal: new AbortController().signal,
			})
				.effect("deliver-message")
				.invoke({
					input: { messageId: callId },
					perform: async () => "delivery:conflict" as const,
				}),
		).rejects.toMatchObject({ name: "DurableEffectConflict" });
		expect(performed).toBe(1);
	},
	180_000,
);

postgresTest(
	"a result outside its declared codec is permanent VALIDATION_FAILED, not eight retries",
	async () => {
		const prepared = await harness();
		const callId = "beta08-codec-0000-0000-000000000010";
		await publish(prepared, { body: "codec guard", callId });
		const runId = await runIdentity(callId);

		// TypeScript is erased at runtime, so a handler can return a value
		// outside its declared result codec. The worker factory here is the one
		// the generated application builds; only the executor differs.
		const worker = createDurableReactionWorker({
			kernel: prepared.kernel,
			ledger: prepared.ledger,
			reactions: linkReactionProjection(
				JSON.parse(prepared.reactionProjectionBytes),
			),
			workerId: "worker:codec",
			execute: async () => ({ deliveryReceipt: 7 }),
		});
		expect(outcomeFor(await worker.poll(), runId)).toMatchObject({
			outcome: "failed",
			failureCode: "VALIDATION_FAILED",
			attemptNumber: 1,
		});
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "failed",
			attemptCount: 1,
			deadLetter: true,
			failureCode: "VALIDATION_FAILED",
		});
		const events = await prepared.kernel.events(runId);
		expect(events.at(-1)).toMatchObject({
			kind: "failed",
			errorCode: "VALIDATION_FAILED",
		});
	},
	180_000,
);

postgresTest(
	"a maintenance command bound to a stale run version is refused and audited",
	async () => {
		const prepared = await harness();
		const actor = prepared.principal;
		const callId = "beta08-version-00-0000-000000000011";
		await publish(prepared, { body: "version fencing", callId });
		const runId = await runIdentity(callId);

		// An operator reads the run, the run moves, and the command it bound to
		// that reading is refused rather than applied to a run it never saw.
		const observed = await prepared.kernel.inspect(runId);
		expect(observed?.version).toBeGreaterThan(0);
		const claimed = await prepared.kernel.claim({
			runId,
			workerId: "worker:version",
		});
		expect(claimed.status).toBe("claimed");
		expect((await prepared.kernel.inspect(runId))?.version).toBeGreaterThan(
			observed!.version,
		);

		expect(
			await prepared.maintenance.cancelRun({
				runId,
				reason: "acting on a stale reading",
				actor,
				expectedVersion: observed!.version,
			}),
		).toMatchObject({
			outcome: "rejected",
			rejectionCode: "VERSION_MISMATCH",
		});
		expect((await prepared.kernel.inspect(runId))?.cancellationRequested).toBe(
			false,
		);

		const current = await prepared.kernel.inspect(runId);
		expect(
			await prepared.maintenance.cancelRun({
				runId,
				reason: "acting on the current reading",
				actor,
				expectedVersion: current!.version,
			}),
		).toMatchObject({ outcome: "applied", rejectionCode: null });

		const audit = await prepared.maintenance.audit(runId);
		expect(
			audit.map(
				({ command, outcome, rejectionCode }) =>
					`${command}:${outcome}:${rejectionCode ?? "none"}`,
			),
		).toEqual([
			"cancelRun:rejected:VERSION_MISMATCH",
			"cancelRun:applied:none",
		]);
		expect(
			audit.every(
				({ actor: recorded }) =>
					recorded.kind === "user" && recorded.id === beta05Ids.principal,
			),
		).toBe(true);
	},
	180_000,
);

postgresTest(
	"cancelling a never-claimed run prevents the handler outright",
	async () => {
		const prepared = await harness();
		const callId = "beta08-precancel-0-0000-000000000012";
		const messageId = await publish(prepared, {
			body: "cancel before claim",
			callId,
		});
		const runId = await runIdentity(callId);
		expect((await prepared.kernel.inspect(runId))?.state).toBe("ready");

		expect(
			await prepared.maintenance.cancelRun({
				runId,
				reason: "stopped before any attempt",
				actor: prepared.principal,
			}),
		).toMatchObject({
			outcome: "applied",
			stateBefore: "ready",
			stateAfter: "cancelled",
		});
		expect(await prepared.kernel.inspect(runId)).toMatchObject({
			state: "cancelled",
			attemptCount: 0,
			currentAttemptId: null,
			failureCode: null,
		});
		expect(
			await prepared.kernel.claim({ runId, workerId: "worker:precancel" }),
		).toEqual({ status: "skipped" });
		expect(
			(await prepared.kernel.events(runId)).map(({ kind }) => kind),
		).toEqual(["accepted", "cancelled"]);
		const [rows] = await database!.unsafe<
			readonly Readonly<{ attempts: number; delivered: number }>[]
		>(
			`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_attempts WHERE run_id = $1) AS attempts,
  (SELECT count(*)::int FROM collaboration.message_events
    WHERE message_id = $2 AND kind = 'delivered') AS delivered`,
			[runId, messageId],
		);
		expect(rows).toEqual({ attempts: 0, delivered: 0 });
	},
	180_000,
);

postgresTest(
	"an effect with no lookup contract is ambiguous the moment its provider call is lost",
	async () => {
		const prepared = await harness();
		const callId = "beta08-nolookup-0-0000-000000000013";
		await publish(prepared, { body: "no lookup contract", callId });
		const runId = await runIdentity(callId);
		const claimed = await prepared.kernel.claim({
			runId,
			workerId: "worker:no-lookup",
		});
		if (claimed.status !== "claimed") throw new Error("claim failed");

		// Without `recover` the kernel has no way to learn whether the provider
		// accepted the request, so the effect stays ambiguous rather than retried.
		await expect(
			createDurableRunHandle({
				ledger: prepared.ledger,
				claim: claimed.claim,
				declaredEffects: ["deliver-message"],
				signal: new AbortController().signal,
			})
				.effect("deliver-message")
				.invoke({
					input: { runId },
					perform: async (): Promise<`delivery:${string}`> => {
						throw new Error("delivery response was lost");
					},
				}),
		).rejects.toMatchObject({ name: "DurableEffectAmbiguous" });
		expect(await prepared.ledger.read(runId)).toEqual([
			expect.objectContaining({
				effectName: "deliver-message",
				status: "ambiguous",
				receipt: null,
			}),
		]);
	},
	180_000,
);
