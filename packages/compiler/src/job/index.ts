import { compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import { normalizeDeclaredErrors } from "../operation-errors";
import type { NormalizedResource } from "../types";

export { renderJobDeclarations, renderJobDispatch } from "./declarations";

type RecordValue = Readonly<Record<string, unknown>>;

function structural(message: string): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-013",
		"structuralTypeError",
		message,
	);
}

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		structural(`${label} must be an object`);
	return value as RecordValue;
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		structural(`${label} must be a positive integer`);
	return value as number;
}

function normalizeRunAs(value: unknown): RecordValue {
	const runAs = record(value, "job.runAs");
	if (
		runAs.kind !== "durableRunAs" ||
		runAs.actor !== "caller" ||
		runAs.whenDenied !== "fail"
	)
		structural('job.runAs must be durable.caller({ whenDenied: "fail" })');
	return { actor: "caller", whenDenied: "fail" };
}

function normalizeRetry(value: unknown): RecordValue {
	const retry = record(value, "job.retry");
	if (
		retry.kind !== "durableRetry" ||
		retry.backoff !== "exponential" ||
		retry.jitter !== "full"
	)
		structural("job.retry must be a durable.retry program");
	const maximumAttempts = positiveInteger(
		retry.maximumAttempts,
		"job.retry.maximumAttempts",
	);
	const initialDelayMilliseconds = positiveInteger(
		retry.initialDelayMilliseconds,
		"job.retry.initialDelay",
	);
	const maximumDelayMilliseconds = positiveInteger(
		retry.maximumDelayMilliseconds,
		"job.retry.maximumDelay",
	);
	const horizonMilliseconds = positiveInteger(
		retry.horizonMilliseconds,
		"job.retry.horizon",
	);
	if (maximumAttempts > 8)
		structural("job.retry.maximumAttempts exceeds the accepted 8 bound");
	if (maximumDelayMilliseconds > 900_000)
		structural("job.retry.maximumDelay exceeds the accepted 900000 ms cap");
	if (horizonMilliseconds > 86_400_000)
		structural("job.retry.horizon exceeds the accepted 86400000 ms bound");
	if (
		maximumDelayMilliseconds < initialDelayMilliseconds ||
		horizonMilliseconds < maximumDelayMilliseconds
	)
		structural("job.retry delays must not decrease");
	return {
		maximumAttempts,
		initialDelayMilliseconds,
		backoff: "exponential",
		maximumDelayMilliseconds,
		jitter: "full",
		horizonMilliseconds,
	};
}

export function normalizeJobContract(
	value: RecordValue,
	normalizeCodec: (value: unknown) => unknown,
): RecordValue {
	if (typeof value.name !== "string") structural("job.name must be a string");
	const allowed = new Set([
		"__questpie",
		"errors",
		"handler",
		"input",
		"name",
		"output",
		"retry",
		"runAs",
		"schedule",
		"signals",
		"version",
	]);
	const unknown = Object.keys(value)
		.filter((key) => !allowed.has(key))
		.sort(compareAscii);
	if (unknown.length > 0)
		structural(`job.${unknown[0]} is outside the Job contract`);
	const signals = value.signals ?? {};
	if (
		!signals ||
		typeof signals !== "object" ||
		Array.isArray(signals) ||
		Object.keys(signals).length > 0
	)
		structural("job.signals are deferred until the checkpoint slice");
	if (value.schedule !== undefined && value.schedule !== null)
		structural("job.schedule is deferred until the cron slice");
	return {
		format: "questpie.job-definition-contract",
		version: 1,
		name: value.name,
		semanticVersion: positiveInteger(value.version ?? 1, "job.version"),
		input: normalizeCodec(value.input),
		output: normalizeCodec(value.output),
		declaredErrors: normalizeDeclaredErrors(
			value.errors,
			"job",
			normalizeCodec,
		),
		runAs: normalizeRunAs(value.runAs),
		retry: normalizeRetry(value.retry),
		signals: {},
		schedule: null,
		executableSlots: ["handler"],
	};
}

export interface JobProjectionV1 {
	readonly format: "questpie.job-projection";
	readonly version: 1;
	readonly jobs: readonly Readonly<Record<string, unknown>>[];
}

export function projectJobContracts(
	resources: readonly NormalizedResource[],
): JobProjectionV1 {
	return Object.freeze({
		format: "questpie.job-projection" as const,
		version: 1 as const,
		jobs: Object.freeze(
			resources
				.filter((resource) => resource.kind === "job")
				.map((resource) =>
					Object.freeze({
						identity: resource.identity,
						semanticVersion: resource.contract.semanticVersion,
						input: resource.contract.input,
						output: resource.contract.output,
						declaredErrors: resource.contract.declaredErrors,
						runAs: resource.contract.runAs,
						retry: resource.contract.retry,
						signals: resource.contract.signals,
						schedule: resource.contract.schedule,
						contractDigest: digest(
							"questpie-executable-contract-v1",
							resource.contract,
						),
						origin: Object.freeze({
							path: resource.origin.logicalPath,
							exportName: resource.origin.exportName,
							packageId: resource.origin.packageId,
						}),
					}),
				)
				.sort((left, right) =>
					compareAscii(String(left.identity), String(right.identity)),
				),
		),
	});
}
