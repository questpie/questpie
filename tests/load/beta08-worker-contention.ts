import { SQL } from "bun";

import baseline from "../../quality/baselines/beta08-worker-contention.json";
import scenario from "../../quality/performance/beta08-worker-contention.json";
import {
	beta05Ids,
	prepareBeta08Durable,
} from "../integration/postgres/helpers/beta08-durable";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("BETA-08 worker contention load requires PostgreSQL");

// The performance manifest invokes this entrypoint outside correctness discovery.

// The tracer Reaction rereads one bounded 100-row Message page, so the
// contended set stays inside the page its handler can observe.
const runs = 64;
const workers = 8;
const sql = new SQL({ max: workers + 2 });

function derivedBudget(
	input: Readonly<{
		referenceObservedMs: number;
		multiplier: number;
		roundUpQuantumMs: number;
	}>,
): number {
	return (
		Math.ceil(
			(input.referenceObservedMs * input.multiplier) / input.roundUpQuantumMs,
		) * input.roundUpQuantumMs
	);
}

const prepared = await prepareBeta08Durable(sql);
try {
	for (let index = 0; index < runs; index += 1)
		await prepared.app.execution(
			{
				principal: prepared.principal,
				context: { companyId: beta05Ids.company },
			},
			({ mutations }) =>
				mutations["message.publish"](
					{
						channelId: beta05Ids.channel,
						body: `contended durable run ${index}`,
					},
					{ callId: `beta08-load-${String(index).padStart(5, "0")}` },
				),
		);

	const fleet = Array.from({ length: workers }, (_unused, index) =>
		prepared.app.durable.worker({
			workerId: `worker:contention-${index}`,
			claimBatch: 64,
		}),
	);
	const started = performance.now();
	let claimed = 0;
	let admitted = 0;
	for (let round = 0; round < Math.ceil(runs / 64) + 1; round += 1) {
		const traces = (await Promise.all(
			fleet.map((worker) => worker.poll()),
		)) as ReadonlyArray<Readonly<{ admitted: number; claimed: number }>>;
		for (const trace of traces) {
			admitted += trace.admitted;
			claimed += trace.claimed;
		}
	}
	const postgresContention64Ms = performance.now() - started;

	const [rows] = await sql.unsafe<
		ReadonlyArray<
			Readonly<{
				runs: number;
				succeeded: number;
				attempts: number;
				superseded: number;
			}>
		>
	>(`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE state = 'succeeded') AS succeeded,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts) AS attempts,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts WHERE outcome = 'leaseSuperseded') AS superseded`);
	if (rows?.runs !== runs || rows.succeeded !== runs)
		throw new Error(
			`expected ${runs} succeeded runs, got ${JSON.stringify(rows)}`,
		);
	if (rows.attempts !== runs || rows.superseded !== 0)
		throw new Error(
			`contended claims produced duplicate attempts ${JSON.stringify(rows)}`,
		);
	if (claimed !== runs)
		throw new Error(`fleet claimed ${claimed} of ${runs} runs`);

	const measurements = {
		postgresContention64Ms,
		durableRuns: rows.runs,
		duplicateAttempts: rows.attempts - runs,
	};
	if (
		baseline.budgets.postgresContention64Ms !==
		derivedBudget(baseline.budgetDerivation.postgresContention64Ms)
	)
		throw new Error("worker contention budget derivation drifted");
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		const measured = measurements[name as keyof typeof measurements];
		if (
			baseline.budgets[name as keyof typeof baseline.budgets] !== metric.budget
		)
			throw new Error(`${name} baseline and manifest budgets disagree`);
		if (metric.direction === "max" && measured > metric.budget)
			throw new Error(`${name} ${measured} exceeds ${metric.budget}`);
		if (metric.direction === "min" && measured < metric.budget)
			throw new Error(`${name} ${measured} is below ${metric.budget}`);
	}
	console.log(
		JSON.stringify({
			scenario: scenario.id,
			budgetOwner: scenario.budgetOwner,
			evidenceClass:
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ??
				baseline.reference.runnerClass,
			workProof: { runs, workers, admitted, claimed },
			measurements,
			status: "PASS",
		}),
	);
} finally {
	await prepared.dispose();
	await sql.close({ timeout: 0 });
}
