import {
	parseUtcCron,
	type StaticJobScheduleArtifact,
	type StaticJobSchedule,
} from "@questpie/runtime/durable-schedule-contract";

import { canonicalBytes, compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { NormalizedResource } from "../types";

/** Separate deployment data; never enters the Job execution contract. */
export function projectJobSchedules(
	input: Readonly<{
		application: string;
		compilerRuntimeBuildDigest: string;
		jobProjectionDigest: string;
		resources: readonly NormalizedResource[];
	}>,
): StaticJobScheduleArtifact {
	const schedules: StaticJobSchedule[] = [];
	for (const resource of input.resources) {
		if (resource.kind !== "job" || resource.value.schedule == null) continue;
		try {
			if (resource.origin.packageId !== null)
				throw new TypeError("Package schedules are outside this candidate");
			const schedule = resource.value.schedule as {
				cron: string;
				execution: {
					principal: { kind: "service"; id: string };
					context: unknown;
				};
				input: unknown;
			};
			const program = {
				jobIdentity: resource.identity,
				cron: parseUtcCron(schedule.cron),
				principal: schedule.execution.principal,
				contextJson: canonicalBytes(schedule.execution.context),
				inputJson: canonicalBytes(schedule.input),
			};
			schedules.push(
				Object.freeze({
					...program,
					programDigest: digest("questpie-job-schedule-program-v1", program),
				}),
			);
		} catch {
			throw new CompilerDiagnosticError(
				"QP-COMPOSE-013",
				"structuralTypeError",
				"invalid static Job schedule",
				{ origin: resource.origin, path: "schedule" },
			);
		}
	}
	schedules.sort((left, right) =>
		compareAscii(left.jobIdentity, right.jobIdentity),
	);
	const artifact = Object.freeze({
		format: "questpie.job-schedules" as const,
		version: 1 as const,
		application: input.application,
		compilerRuntimeBuildDigest: input.compilerRuntimeBuildDigest,
		jobProjectionDigest: input.jobProjectionDigest,
		digest: digest("questpie-job-schedule-set-v1", {
			application: input.application,
			schedules,
		}),
		schedules: Object.freeze(schedules),
	});
	if (
		schedules.length > 64 ||
		Buffer.byteLength(canonicalBytes(artifact), "utf8") > 262_144
	)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"static Job schedule set exceeds its finite bound",
		);
	return artifact;
}
