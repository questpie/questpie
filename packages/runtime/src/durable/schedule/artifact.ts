import { createHash } from "node:crypto";

import {
	canonicalMutationBytes,
	deterministicUuid,
} from "../../mutation/canonical";
import { parseUtcCron } from "./calendar";
import {
	StaticScheduleFailure,
	type StaticJobScheduleArtifact,
} from "./contract";

export function scheduleDigest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(domain)
		.update("\0")
		.update(canonicalMutationBytes(value))
		.digest("hex");
}

export function scheduleTickIdentity(
	application: string,
	jobIdentity: string,
	minute: Date,
): string {
	return deterministicUuid(
		canonicalMutationBytes({
			application,
			jobIdentity,
			scheduledMinute: minute.toISOString(),
			format: "questpie.schedule-tick.v1",
		}),
	);
}

function exact(value: object, keys: string[]) {
	if (Object.keys(value).sort().join("\0") !== keys.sort().join("\0"))
		throw new Error();
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === "object") {
		Object.freeze(value);
		for (const member of Object.values(value)) deepFreeze(member);
	}
	return value;
}

/** Snapshots and independently verifies deployment data before PostgreSQL work. */
export function verifyStaticScheduleArtifact(
	source: unknown,
	bindings: Readonly<{
		application: string;
		compilerRuntimeBuildDigest: string;
		jobProjectionDigest: string;
	}>,
): StaticJobScheduleArtifact {
	try {
		const bytes = canonicalMutationBytes(source);
		if (bytes.byteLength > 262_144) throw new Error();
		const value = JSON.parse(
			new TextDecoder().decode(bytes),
		) as StaticJobScheduleArtifact;
		exact(value, [
			"format",
			"version",
			"application",
			"compilerRuntimeBuildDigest",
			"jobProjectionDigest",
			"digest",
			"schedules",
		]);
		if (
			value.format !== "questpie.job-schedules" ||
			value.version !== 1 ||
			!value.application ||
			value.application.includes("\0")
		)
			throw new Error();
		for (const key of [
			"application",
			"compilerRuntimeBuildDigest",
			"jobProjectionDigest",
		] as const)
			if (value[key] !== bindings[key]) throw new Error();
		for (const key of [
			"compilerRuntimeBuildDigest",
			"jobProjectionDigest",
			"digest",
		] as const)
			if (!/^[a-f0-9]{64}$/u.test(value[key])) throw new Error();
		if (!Array.isArray(value.schedules) || value.schedules.length > 64)
			throw new Error();
		for (const [index, schedule] of value.schedules.entries()) {
			exact(schedule, [
				"jobIdentity",
				"programDigest",
				"cron",
				"principal",
				"contextJson",
				"inputJson",
			]);
			if (
				!schedule.jobIdentity.startsWith("job:") ||
				schedule.jobIdentity.length <= 4 ||
				schedule.jobIdentity.includes("\0") ||
				(index > 0 &&
					value.schedules[index - 1]!.jobIdentity >= schedule.jobIdentity)
			)
				throw new Error();
			exact(schedule.principal, ["kind", "id"]);
			if (
				schedule.principal.kind !== "service" ||
				typeof schedule.principal.id !== "string" ||
				!schedule.principal.id ||
				schedule.principal.id.includes("\0")
			)
				throw new Error();
			if (schedule.principal.id.normalize("NFC") !== schedule.principal.id)
				throw new Error();
			const parsed = parseUtcCron(schedule.cron.canonical);
			if (
				scheduleDigest("calendar", parsed) !==
				scheduleDigest("calendar", schedule.cron)
			)
				throw new Error();
			for (const json of [schedule.contextJson, schedule.inputJson]) {
				if (
					typeof json !== "string" ||
					new TextDecoder().decode(canonicalMutationBytes(JSON.parse(json))) !==
						json
				)
					throw new Error();
			}
			const { programDigest, ...program } = schedule;
			if (
				scheduleDigest("questpie-job-schedule-program-v1", program) !==
				programDigest
			)
				throw new Error();
		}
		if (
			scheduleDigest("questpie-job-schedule-set-v1", {
				application: value.application,
				schedules: value.schedules,
			}) !== value.digest
		)
			throw new Error();
		return deepFreeze(value);
	} catch {
		throw new StaticScheduleFailure("SCHEDULE_ARTIFACT_INVALID");
	}
}
