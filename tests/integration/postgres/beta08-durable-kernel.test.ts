import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";

import {
	beta05Ids,
	prepareBeta08Durable,
	retiredDurableKernel,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;
const encoder = new TextEncoder();

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

postgresTest(
	"a worker crash after claim cannot let the stale lease holder publish a terminal transition, and one fact keeps one Reaction",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-fence-0000-0000-000000000001";
			await publish(prepared, { body: "fence probe", callId });

			const runId = await runIdentity(callId);
			const [dispatchCount] = await database!.unsafe<
				readonly Readonly<{ runs: number; intents: number }>[]
			>(
				`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS runs,
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
			const recovered = await prepared.kernel.claim({
				runId,
				workerId: "worker:recovered",
				leaseMilliseconds: 30_000,
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
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);

postgresTest(
	"concurrent SKIP LOCKED claims hand one ready run to exactly one worker",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
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
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);

postgresTest(
	"retry exhaustion ends in one dead letter and never defers past the run horizon",
	async () => {
		// Full jitter draws uniformly from [0, cap); this run takes the lower
		// bound of its own declared distribution so the tracer stays bounded.
		const prepared = await prepareBeta08Durable(database!, { random: () => 0 });
		try {
			const callId = "beta08-retry-0000-0000-000000000003";
			await publish(prepared, { body: "retry program", callId });
			const runId = await runIdentity(callId);
			const states: string[] = [];
			for (let attempt = 1; attempt <= 8; attempt += 1) {
				const claimed = await prepared.kernel.claim({
					runId,
					workerId: `worker:retry-${attempt}`,
				});
				expect(claimed.status).toBe("claimed");
				if (claimed.status !== "claimed") throw new Error("claim failed");
				expect(claimed.claim.attemptNumber).toBe(attempt);
				const transition = await prepared.kernel.fail(claimed.claim, {
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
			const kinds = (await prepared.kernel.events(runId)).map(
				({ kind }) => kind,
			);
			expect(kinds.filter((kind) => kind === "retryScheduled")).toHaveLength(7);
			expect(kinds.filter((kind) => kind === "failed")).toHaveLength(1);
		} finally {
			await prepared.dispose();
		}
	},
	180_000,
);

postgresTest(
	"a cancellation request during a handler competes with success through one fenced transition",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
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
				actor: { kind: "user", id: beta05Ids.principal },
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
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);

postgresTest(
	"a worker without compatible executable bytes refuses the claim instead of consuming an attempt",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-retire-000-0000-000000000005";
			await publish(prepared, { body: "executable retirement", callId });
			const runId = await runIdentity(callId);
			const retired = retiredDurableKernel(
				database!,
				prepared.reactionProjectionBytes,
			);
			expect(
				await retired.claim({ runId, workerId: "worker:retired" }),
			).toEqual({ status: "refused", code: "EXECUTABLE_RETIRED" });
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
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);

postgresTest(
	"concurrent maintenance commands elect one winner and audit every attempt",
	async () => {
		const prepared = await prepareBeta08Durable(database!);
		try {
			const callId = "beta08-command-00-0000-000000000006";
			await publish(prepared, { body: "maintenance", callId });
			const runId = await runIdentity(callId);
			const actor = { kind: "user", id: beta05Ids.principal } as const;

			const cancels = await Promise.all([
				prepared.maintenance.cancelRun({ runId, reason: "left", actor }),
				prepared.maintenance.cancelRun({ runId, reason: "right", actor }),
			]);
			expect(
				cancels.filter(({ outcome }) => outcome === "applied"),
			).toHaveLength(1);
			expect(
				cancels.filter(
					({ outcome, rejectionCode }) =>
						outcome === "rejected" &&
						(rejectionCode === "ALREADY_REQUESTED" ||
							rejectionCode === "RUN_IS_TERMINAL"),
				),
			).toHaveLength(1);
			expect((await prepared.kernel.inspect(runId))?.state).toBe("cancelled");

			const retries = await Promise.all([
				prepared.maintenance.retryRun({ runId, actor }),
				prepared.maintenance.retryRun({ runId, actor }),
			]);
			expect(retries.every(({ outcome }) => outcome === "rejected")).toBe(true);
			expect(
				retries.every(
					({ rejectionCode }) => rejectionCode === "RUN_NOT_FAILED",
				),
			).toBe(true);

			const acknowledgements = await Promise.all([
				prepared.maintenance.acknowledgeAmbiguity({
					runId,
					effectName: "deliver-message",
					actor,
				}),
				prepared.maintenance.acknowledgeAmbiguity({
					runId,
					effectName: "deliver-message",
					actor,
				}),
			]);
			expect(
				acknowledgements.every(
					({ outcome, rejectionCode }) =>
						outcome === "rejected" && rejectionCode === "NOT_AMBIGUOUS",
				),
			).toBe(true);

			const audit = await prepared.maintenance.audit(runId);
			expect(audit).toHaveLength(6);
			expect(audit.filter(({ outcome }) => outcome === "applied")).toHaveLength(
				1,
			);
			expect(
				audit.every(
					({ actor: recorded }) =>
						recorded.kind === "user" && recorded.id === beta05Ids.principal,
				),
			).toBe(true);
		} finally {
			await prepared.dispose();
		}
	},
	120_000,
);
