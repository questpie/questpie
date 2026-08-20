import { SQL } from "bun";

import scenario from "../../quality/performance/beta10-ten-instance.json";
import {
	beta05Ids,
	beta08Harness,
	disposeBeta08Harness,
} from "../integration/postgres/helpers/beta08-durable";

if (!process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER)
	throw new Error("BETA-10 ten-instance load requires PostgreSQL");

const instanceCount = 10;
const runs = 40;
const database = new SQL({ max: instanceCount + 2 });
const prepared = await beta08Harness(database);

try {
	const applications = [prepared.app];
	applications.push(
		...(await Promise.all(
			Array.from({ length: instanceCount - 1 }, () =>
				prepared.createSiblingApplication(),
			),
		)),
	);
	const started = performance.now();
	let directRoots = 0;
	let networkPosts = 0;
	for (let index = 0; index < runs; index += 1) {
		const application = applications[index % applications.length]!;
		const input = {
			channelId: beta05Ids.channel,
			body: `ten-instance run ${index}`,
		};
		if (index % 2 === 0) {
			await application.execution(
				{
					principal: prepared.principal,
					context: { companyId: beta05Ids.company },
				},
				({ mutations }) =>
					mutations["message.publish"](input, {
						callId: `beta10-direct-${String(index).padStart(5, "0")}`,
					}),
			);
			directRoots += 1;
		} else {
			const frame = prepared.wireFrame("mutation:message.publish", input);
			const response = await application.fetch(
				prepared.bindPrincipal(
					new Request("http://runtime.test/_questpie/operation", {
						method: "POST",
						headers: { "content-type": frame.mediaType },
						body: frame.body,
					}),
				),
			);
			if (response.status !== 200)
				throw new Error(`network publication failed with ${response.status}`);
			const result = (await response.json()) as Readonly<{ kind?: unknown }>;
			if (result.kind !== "result")
				throw new Error(`network publication returned ${String(result.kind)}`);
			networkPosts += 1;
		}
	}

	const workers = applications.map((application, index) =>
		application.durable.worker({
			workerId: `worker:beta10-${index}`,
			claimBatch: 64,
		}),
	);
	await applications[0]!.close();
	const drained = (await workers[0]!.poll()) as Readonly<{ admitted: number }>;
	let claimed = 0;
	for (let round = 0; round < 10 && claimed < runs; round += 1) {
		const traces = (await Promise.all(
			workers.slice(1).map((worker) => worker.poll()),
		)) as ReadonlyArray<Readonly<{ claimed: number }>>;
		claimed += traces.reduce((sum, trace) => sum + trace.claimed, 0);
	}
	const tenInstance40Ms = performance.now() - started;
	const [rows] = await database.unsafe<
		ReadonlyArray<
			Readonly<{
				runs: number;
				succeeded: number;
				attempts: number;
			}>
		>
	>(`SELECT
  (SELECT count(*)::int FROM questpie_internal.durable_runs) AS runs,
  (SELECT count(*)::int FROM questpie_internal.durable_runs WHERE state = 'succeeded') AS succeeded,
  (SELECT count(*)::int FROM questpie_internal.durable_attempts) AS attempts`);
	if (rows?.runs !== runs || rows.succeeded !== runs || claimed !== runs)
		throw new Error(
			`ten-instance fleet did not finish every run: ${JSON.stringify({ rows, claimed })}`,
		);
	const measurements = {
		tenInstance40Ms,
		runtimeInstances: applications.length,
		directRoots,
		networkPosts,
		durableRuns: rows.runs,
		duplicateAttempts: rows.attempts - rows.runs,
		drainedWorkerAdmissions: drained.admitted,
	};
	for (const [name, metric] of Object.entries(scenario.metrics)) {
		const measured = measurements[name as keyof typeof measurements];
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
			workProof: { claimed, optionalAccelerators: 0 },
			measurements,
			status: "PASS",
		}),
	);
} finally {
	await disposeBeta08Harness();
	await database.close({ timeout: 0 });
}
