import { afterAll, expect, test } from "bun:test";

import { SQL } from "bun";
import { principal } from "questpie";

import { createPostgresDurableMaintenance } from "../../../packages/runtime/src/durable/postgres-maintenance";
import {
	durableKernelMarkerStatement,
	durableKernelUnmarkStatement,
} from "../../../packages/runtime/src/durable/rows";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
	type Beta08Harness,
} from "./helpers/beta08-durable";

const database = process.env.PGHOST ? new SQL({ max: 8 }) : undefined;
const postgresTest = process.env.PGHOST ? test : test.skip;

async function maintenanceStatements(authorize: boolean): Promise<string[]> {
	const statements: string[] = [];
	const row = {
		state: "ready",
		attemptCount: 0,
		deadLetter: false,
		resource: "reaction:messagePublished",
		dispatchId: crypto.randomUUID(),
		causationId: crypto.randomUUID(),
		correlationId: crypto.randomUUID(),
		cancellationRequested: false,
		version: 1,
	};
	const unsafe = async (statement: string): Promise<readonly unknown[]> => {
		statements.push(statement);
		if (statement.includes("SELECT state")) return [row];
		if (statement.includes('RETURNING event_sequence AS "sequence"'))
			return [{ sequence: 2 }];
		if (statement.includes('SELECT event_sequence AS "version"'))
			return [{ version: 2 }];
		return [];
	};
	const sql = {
		begin: async (use: (session: { unsafe: typeof unsafe }) => unknown) =>
			use({ unsafe }),
	} as unknown as SQL;
	const maintenance = createPostgresDurableMaintenance({
		sql,
		application: "application:collaboration",
		authorize: () => authorize,
	});
	await maintenance.cancelRun({
		runId: crypto.randomUUID(),
		reason: "row-lock ordering probe",
		actor: principal.user({ id: crypto.randomUUID() }),
	});
	return statements;
}

test("maintenance Authority denial happens before a row lock", async () => {
	const denied = await maintenanceStatements(false);
	expect(denied.some((statement) => statement.includes("FOR UPDATE"))).toBe(
		false,
	);

	// Positive control: the same instrument observes the authorized lock path.
	const authorized = await maintenanceStatements(true);
	expect(authorized.some((statement) => statement.includes("FOR UPDATE"))).toBe(
		true,
	);
});

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
 * ADR-0024 retains maintenance as a server-internal capability and forbids it
 * from becoming ambient Admin/System authority. `readerPrincipal` is an active
 * ordinary member; the host maintenance authorizer must refuse it before the
 * command locks or mutates the run.
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
		expect(denials[0]!.reason).toBe("unauthorized maintenance attempt");
	},
);

postgresTest(
	"a fenced loser receives the current version and can recover with it",
	async () => {
		const prepared = await harness();
		const callId = "beta09-version-1";
		await publish(prepared, { body: "beta09 version fence", callId });
		const runId = await runIdentity(callId);
		const current = await prepared.app.durable.inspect(runId);
		expect(current).not.toBeNull();

		const refused = await prepared.app.durable.cancelRun({
			runId,
			reason: "stale operator view",
			actor: prepared.principal,
			expectedVersion: current!.version - 1,
		});
		expect(refused).toMatchObject({
			outcome: "rejected",
			rejectionCode: "VERSION_MISMATCH",
			version: current!.version,
		});

		const applied = await prepared.app.durable.cancelRun({
			runId,
			reason: "retry against reported winner",
			actor: prepared.principal,
			expectedVersion: refused.version,
		});
		expect(applied.outcome).toBe("applied");
		expect(applied.version).toBeGreaterThan(refused.version);
	},
);

postgresTest(
	"lowering the kernel marker re-arms the durable write guard",
	async () => {
		await harness();
		const [row] = await database!.unsafe<
			Readonly<Array<{ application: string; runId: string }>>
		>(`SELECT application_name AS application, run_id::text AS "runId"
FROM questpie_internal.durable_runs LIMIT 1`);
		expect(row?.runId).toBeString();
		const update = `UPDATE questpie_internal.durable_runs SET event_sequence = event_sequence
WHERE application_name = $1 AND run_id = $2`;
		let markedAccepted = false;
		let unmarkedRefused = false;
		await database!
			.begin(async (session) => {
				await session.unsafe(durableKernelMarkerStatement);
				await session.unsafe(update, [row!.application, row!.runId]);
				markedAccepted = true;
				await session.unsafe(durableKernelUnmarkStatement);
				try {
					await session.unsafe(update, [row!.application, row!.runId]);
				} catch {
					unmarkedRefused = true;
				}
				throw new Error("rollback probe");
			})
			.catch(() => undefined);
		expect(markedAccepted).toBe(true);
		expect(unmarkedRefused).toBe(true);
	},
);

postgresTest(
	"every maintenance command rejects an invalid reason before mutation",
	async () => {
		const prepared = await harness();
		const callId = "beta09-reason-1";
		await publish(prepared, { body: "beta09 reason bounds", callId });
		const runId = await runIdentity(callId);
		const actor = principal.user({ id: beta05Ids.principal });
		const maintenance = createPostgresDurableMaintenance({
			sql: database!,
			application: "application:collaboration",
			authorize: () => true,
		});

		const refusals = await Promise.all([
			maintenance.cancelRun({ runId, reason: "", actor }),
			maintenance.retryRun({ runId, reason: "x".repeat(257), actor }),
			maintenance.acknowledgeAmbiguity({
				runId,
				effectName: "deliver-message",
				reason: "",
				actor,
			}),
		]);
		expect(
			refusals.every(
				({ outcome, rejectionCode }) =>
					outcome === "rejected" && rejectionCode === "REASON_INVALID",
			),
		).toBe(true);
		expect(await prepared.app.durable.inspect(runId)).toMatchObject({
			state: "ready",
			cancellationRequested: false,
		});
	},
);

/**
 * Positive control: the fixture's explicitly authorized operator still
 * applies the command.
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
