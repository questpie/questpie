import { SQL } from "bun";

import baseline from "../../quality/baselines/beta10-soak-chaos.json";
import scenario from "../../quality/performance/beta10-soak-chaos.json";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "../integration/postgres/helpers/beta08-durable";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("BETA-10 soak/chaos requires PostgreSQL");

const instanceCount = 10;
const runCount = 80;
const database = new SQL({ max: instanceCount + 4 });
const prepared = await beta08Harness(database);

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

try {
	const applications = [
		prepared.app,
		await prepared.createCompatibleV4Application(),
	];
	for (let index = applications.length; index < instanceCount; index += 1)
		applications.push(await prepared.createSiblingApplication());

	const started = performance.now();
	const workers = applications.map((application, index) =>
		application.durable.worker({
			workerId: `worker:soak-${index}`,
			claimBatch: 64,
		}),
	);
	let drainedWorkerAdmissions = 0;
	let replacementInstances = 0;
	let claimed = 0;
	for (let wave = 0; wave < 4; wave += 1) {
		for (let offset = 0; offset < 20; offset += 1) {
			const index = wave * 20 + offset;
			const application = applications[index % applications.length]!;
			await application.execution(
				{
					principal: prepared.principal,
					context: { companyId: beta05Ids.company },
				},
				({ mutations }) =>
					mutations["message.publish"](
						{
							channelId: beta05Ids.channel,
							body: `soak run ${index}`,
						},
						{ callId: `beta10-soak-${String(index).padStart(5, "0")}` },
					),
			);
		}
		if (wave === 0) {
			const [abandonedAdmission] = await prepared.kernel.admit(1);
			if (!abandonedAdmission)
				throw new Error("soak could not admit crash probe");
			const abandoned = await prepared.kernel.claim({
				runId: abandonedAdmission.runId,
				workerId: "worker:abandoned",
				leaseMilliseconds: 1_000,
				attemptDeadlineMilliseconds: 1_000,
			});
			if (abandoned.status !== "claimed")
				throw new Error(`soak crash probe was ${abandoned.status}`);
		}
		if (wave < 3) {
			const retiringIndex = wave * 3;
			await applications[retiringIndex]!.close();
			const drained = (await workers[retiringIndex]!.poll()) as Readonly<{
				admitted: number;
			}>;
			drainedWorkerAdmissions += drained.admitted;
			applications[retiringIndex] = await prepared.createSiblingApplication();
			workers[retiringIndex] = applications[retiringIndex]!.durable.worker({
				workerId: `worker:replacement-${wave}`,
				claimBatch: 64,
			});
			replacementInstances += 1;
		}
		const waveTarget = (wave + 1) * 20;
		for (let round = 0; round < 10 && claimed < waveTarget; round += 1) {
			const traces = (await Promise.all(
				workers.map((worker) => worker.poll()),
			)) as ReadonlyArray<Readonly<{ claimed: number }>>;
			claimed += traces.reduce((sum, trace) => sum + trace.claimed, 0);
			if (wave === 0 && round === 0) await Bun.sleep(1_100);
		}
	}

	const soak80Ms = performance.now() - started;
	const [rows] = await database.unsafe<
		ReadonlyArray<
			Readonly<{
				runs: number;
				succeeded: number;
				failed: number;
				attempts: number;
			}>
		>
	>(`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE state = 'succeeded') AS succeeded,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE state = 'failed') AS failed,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts) AS attempts`);
	const recoveredCrashAttempts = (rows?.attempts ?? 0) - (rows?.runs ?? 0);
	if (
		rows?.runs !== runCount ||
		rows.succeeded !== runCount ||
		claimed !== runCount ||
		recoveredCrashAttempts !== 1
	)
		throw new Error(
			`soak fleet did not recover exactly once: ${JSON.stringify({ rows, claimed })}`,
		);
	const measurements = {
		soak80Ms,
		durableRuns: rows.runs,
		recoveredCrashAttempts,
		failedRuns: rows.failed,
		drainedWorkerAdmissions,
		replacementInstances,
	};
	if (
		baseline.budgets.soak80Ms !==
		derivedBudget(baseline.budgetDerivation.soak80Ms)
	)
		throw new Error("soak/chaos budget derivation drifted");
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
				process.env.QUESTPIE_PERFORMANCE_EVIDENCE_CLASS ?? "reference-local",
			workProof: {
				claimed,
				compatibleV4Instances: 1,
				optionalAccelerators: 0,
			},
			measurements,
			status: "PASS",
		}),
	);
} finally {
	await disposeBeta08Harness();
	await database.close({ timeout: 0 });
}
