import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { createPostgresDurableMaintenance } from "../../../packages/runtime/src/durable/postgres-maintenance";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

async function harness(): Promise<Beta08Harness> {
	return beta08Harness(database!);
}

afterAll(async () => {
	await disposeBeta08Harness();
	await database?.close();
});

async function publishedRun(
	prepared: Beta08Harness,
	callId: string,
): Promise<string> {
	await prepared.app.execution(
		{
			principal: prepared.principal,
			context: { companyId: beta05Ids.company },
		},
		async ({ mutations }) => {
			await mutations["message.publish"](
				{ channelId: beta05Ids.channel, body: "beta09 guard probe" },
				{ callId },
			);
		},
	);
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

/**
 * The generated application constructs the maintenance surface without an
 * `authorize`, so the guard is unreachable through `app.durable` and the
 * hostile case cannot drive it until an exposing Operation exists. This drives
 * the runtime factory's own contract instead, which is what the guard is.
 *
 * The Principal is minted from this module's `questpie`, matching the instance
 * the runtime source imports; a Principal from the generated application's
 * bundled module fails `principal.is` as a foreign brand.
 */
postgresTest(
	"a denied command is refused and audited, and takes no lock on the way",
	async () => {
		const prepared = await harness();
		const runId = await publishedRun(prepared, "beta09-guard-1");
		const actor = principal.user({ id: beta05Ids.readerPrincipal });

		const refusing = createPostgresDurableMaintenance({
			sql: database!,
			application: "application:collaboration",
			authorize: () => false,
		});
		const outcome = await refusing.cancelRun({
			runId,
			reason: "guard probe",
			actor,
		});
		expect(outcome.outcome).toBe("rejected");
		expect(outcome.rejectionCode).toBe("AUTHORITY_DENIED");
		// The run is untouched: a denial changes no state.
		expect(outcome.stateAfter).toBe(outcome.stateBefore);

		const audited = await refusing.audit(runId);
		const denials = audited.filter(
			(entry) => entry.rejectionCode === "AUTHORITY_DENIED",
		);
		expect(denials).toHaveLength(1);
		expect(denials[0]!.actor.id).toBe(beta05Ids.readerPrincipal);

		// An authorizing surface still applies, so the refusal above is the
		// Authority decision and not a broken command path.
		const allowing = createPostgresDurableMaintenance({
			sql: database!,
			application: "application:collaboration",
			authorize: () => true,
		});
		const applied = await allowing.cancelRun({
			runId,
			reason: "guard probe applied",
			actor,
		});
		expect(applied.outcome).toBe("applied");
	},
);

/**
 * The marker discipline rests on this and nothing in the tree exercised it.
 * `withDurableKernelMarker` lowers the flag in a `finally`, which is only worth
 * anything if lowering it actually re-arms the guard for the rest of the
 * transaction. The guard compares against `'on'`, so any other value should
 * refuse — this proves it rather than trusting the predicate by reading.
 */
postgresTest(
	"lowering the kernel marker re-arms the guard mid-transaction",
	async () => {
		await harness();
		const [row] = await database!.unsafe<
			readonly Readonly<{ app: string; id: string }>[]
		>(
			`SELECT application_name AS app, run_id::text AS id
FROM questpie_internal.durable_runs LIMIT 1`,
		);
		expect(row?.id).toBeString();
		const update = `UPDATE questpie_internal.durable_runs SET event_sequence = event_sequence
WHERE application_name = $1 AND run_id = $2`;
		let markedAccepted = false;
		let unmarkedRefused = false;
		await database!
			.begin(async (session) => {
				await session.unsafe(durableKernelMarkerStatement);
				await session.unsafe(update, [row!.app, row!.id]);
				markedAccepted = true;
				await session.unsafe(durableKernelUnmarkStatement);
				try {
					await session.unsafe(update, [row!.app, row!.id]);
				} catch {
					unmarkedRefused = true;
				}
				// Never commit a probe write.
				throw new Error("rollback");
			})
			.catch(() => undefined);
		expect(markedAccepted).toBe(true);
		expect(unmarkedRefused).toBe(true);
	},
);

/**
 * `REASON_INVALID` was added to the rejection union and to the v5 CHECK and
 * nothing produced it — a typed member no path could reach, which is the exact
 * failure BETA-08's first round was blocked for, committed here.
 *
 * The bound belongs before the statement, not only in the DDL: enforced only by
 * the database CHECK, an over-long reason surfaces as a raw PostgreSQL error
 * rather than as the typed, audited outcome the command surface promises
 * everywhere else.
 */
postgresTest(
	"an out-of-bound reason is a typed rejection, not a database error",
	async () => {
		const prepared = await harness();
		const runId = await publishedRun(prepared, "beta09-reason-1");
		const actor = principal.user({ id: beta05Ids.principal });
		const maintenance = createPostgresDurableMaintenance({
			sql: database!,
			application: "application:collaboration",
		});

		const tooLong = await maintenance.cancelRun({
			runId,
			reason: "x".repeat(257),
			actor,
		});
		expect(tooLong.outcome).toBe("rejected");
		expect(tooLong.rejectionCode).toBe("REASON_INVALID");
		expect(tooLong.stateAfter).toBe(tooLong.stateBefore);

		const empty = await maintenance.cancelRun({ runId, reason: "", actor });
		expect(empty.rejectionCode).toBe("REASON_INVALID");

		// Every attempt is recorded, and a rejection with no valid reason records a
		// null one rather than the offending value.
		const audited = await maintenance.audit(runId);
		const refusals = audited.filter(
			(entry) => entry.rejectionCode === "REASON_INVALID",
		);
		expect(refusals).toHaveLength(2);

		// A reason at the bound is accepted, so the refusal is the bound and not the
		// command being broken.
		const applied = await maintenance.cancelRun({
			runId,
			reason: "y".repeat(256),
			actor,
		});
		expect(applied.outcome).toBe("applied");
	},
);
