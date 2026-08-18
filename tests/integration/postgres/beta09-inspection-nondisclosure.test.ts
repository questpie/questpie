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
 * The prescribed red test, aimed at the lane where it actually bites.
 *
 * Application data reaches Studio only through ordinary generated Operations
 * and Collection Policy, so disclosure equivalence there is definitional.
 * Operational facts are not Collection rows: no Collection Policy covers them,
 * and the published durable surface returns the Reaction's encoded result and
 * the provider's receipt verbatim. An output codec is a shape contract, not an
 * authorization filter, so whatever a handler returns is disclosed to every
 * caller that reaches this surface.
 *
 * This asserts the contract `inspection-contract.md` decided: the inspection
 * projection is strictly narrower than the kernel read. Result becomes
 * presence, length and digest; receipt becomes presence.
 */
postgresTest(
	"the published durable surface discloses no Reaction result body or provider receipt",
	async () => {
		const prepared = await harness();
		const callId = "beta09-nondisclosure-1";
		await publish(prepared, { body: "beta09 nondisclosure probe", callId });
		const runId = await runIdentity(callId);

		await prepared.app.durable.poll();

		const view = await prepared.app.durable.inspect(runId);
		expect(view?.state).toBe("succeeded");

		// The kernel keeps result bytes because the worker needs them. Nothing
		// reachable through the published surface may return them.
		expect(view).not.toHaveProperty("resultBytes");

		const effects = await prepared.app.durable.effects(runId);
		expect(effects).toHaveLength(1);
		// A provider receipt is arbitrary provider text. Presence is the fact an
		// operator needs; the text itself is not this surface's to disclose.
		expect(effects[0]).not.toHaveProperty("receipt");
	},
);
