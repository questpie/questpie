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

/**
 * BETA-08 shipped six of the seven properties ADR-0014 requires of a
 * maintenance command and disclosed the seventh: nothing evaluates maintenance
 * Authority. `actorOf` checks `principalKernel.is`, which proves the value came
 * from the application's own module and proves nothing about whether this actor
 * may cancel this run.
 *
 * `authority-mechanism.md` decides the mechanism: an ordinary Policy decision
 * evaluated inside an Execution, adding no Authority class. `readerPrincipal`
 * is an active `member`, a role the Message Policy already treats as
 * insufficient for governed content, and is the caller that must be refused.
 */
postgresTest(
	"a caller without maintenance Authority is refused and the attempt is audited",
	async () => {
		const prepared = await harness();
		const callId = "beta09-authority-1";
		await publish(prepared, { body: "beta09 authority probe", callId });
		const runId = await runIdentity(callId);

		const outcome = await prepared.app.durable.cancelRun({
			runId,
			reason: "unauthorized maintenance attempt",
			actor: prepared.readerPrincipal,
		});

		expect(outcome.outcome).toBe("rejected");
		expect(outcome.rejectionCode).toBe("AUTHORITY_DENIED");

		// Every attempt is recorded, applied or rejected. A denial that leaves no
		// trace is the artifact this slice is trying not to ship.
		const audit = await prepared.app.durable.audit(runId);
		const denials = audit.filter(
			(entry) => entry.rejectionCode === "AUTHORITY_DENIED",
		);
		expect(denials).toHaveLength(1);
		expect(denials[0]!.actor.id).toBe(beta05Ids.readerPrincipal);
	},
);

/**
 * The other half of Q3: the two Authorities are distinct, so holding one does
 * not confer the other. An admin member is authorized here.
 */
postgresTest(
	"a caller with maintenance Authority still applies the command",
	async () => {
		const prepared = await harness();
		const callId = "beta09-authority-2";
		await publish(prepared, { body: "beta09 authority allowed", callId });
		const runId = await runIdentity(callId);

		const outcome = await prepared.app.durable.cancelRun({
			runId,
			reason: "authorized maintenance attempt",
			actor: prepared.principal,
		});

		expect(outcome.outcome).toBe("applied");
		expect(outcome.rejectionCode).toBeNull();
	},
);
