import { compareAscii, digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import { normalizeDeclaredErrors } from "../operation-errors";
import type { NormalizedResource } from "../types";

export {
	renderDurableDeclarations,
	renderReactionDeclarations,
	renderReactionDispatch,
} from "./declarations";
export {
	durableKernelContract,
	durableKernelDigest,
	type DurableKernelContractV1,
} from "./durable-kernel";

type RecordValue = Readonly<Record<string, unknown>>;

const effectNamePattern = /^[a-z][a-z0-9-]{0,62}$/;
const maximumEffectNames = 8;

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

function normalizeRunAs(value: unknown): RecordValue {
	const runAs = record(value, "reaction.runAs");
	if (
		runAs.kind !== "durableRunAs" ||
		runAs.actor !== "caller" ||
		runAs.whenDenied !== "fail"
	)
		structural('reaction.runAs must be durable.caller({ whenDenied: "fail" })');
	return { actor: "caller", whenDenied: "fail" };
}

function positiveInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < 1)
		structural(`${label} must be a positive integer`);
	return value as number;
}

function normalizeRetry(value: unknown): RecordValue {
	const retry = record(value, "reaction.retry");
	if (
		retry.kind !== "durableRetry" ||
		retry.backoff !== "exponential" ||
		retry.jitter !== "full"
	)
		structural("reaction.retry must be a durable.retry program");
	const maximumAttempts = positiveInteger(
		retry.maximumAttempts,
		"reaction.retry.maximumAttempts",
	);
	const initialDelayMilliseconds = positiveInteger(
		retry.initialDelayMilliseconds,
		"reaction.retry.initialDelay",
	);
	const maximumDelayMilliseconds = positiveInteger(
		retry.maximumDelayMilliseconds,
		"reaction.retry.maximumDelay",
	);
	const horizonMilliseconds = positiveInteger(
		retry.horizonMilliseconds,
		"reaction.retry.horizon",
	);
	if (maximumAttempts > 8)
		structural("reaction.retry.maximumAttempts exceeds the accepted 8 bound");
	if (maximumDelayMilliseconds > 900_000)
		structural(
			"reaction.retry.maximumDelay exceeds the accepted 900000 ms cap",
		);
	if (horizonMilliseconds > 86_400_000)
		structural("reaction.retry.horizon exceeds the accepted 86400000 ms bound");
	if (
		maximumDelayMilliseconds < initialDelayMilliseconds ||
		horizonMilliseconds < maximumDelayMilliseconds
	)
		structural("reaction.retry delays must not decrease");
	return {
		maximumAttempts,
		initialDelayMilliseconds,
		backoff: "exponential",
		maximumDelayMilliseconds,
		jitter: "full",
		horizonMilliseconds,
	};
}

function normalizeEffects(value: unknown): readonly string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) structural("reaction.effects must be an array");
	const names = value as readonly unknown[];
	if (names.length > maximumEffectNames)
		structural(
			`reaction.effects declares more than ${maximumEffectNames} literal effect names`,
		);
	const normalized = names.map((name, index) => {
		if (typeof name !== "string" || !effectNamePattern.test(name))
			structural(`reaction.effects[${index}] is not a literal effect name`);
		return name as string;
	});
	const sorted = [...normalized].sort(compareAscii);
	if (new Set(sorted).size !== sorted.length)
		structural("reaction.effects contains a duplicate effect name");
	return sorted;
}

/**
 * BETA-08 owns the executed Reaction. The contract carries the authored
 * handler's declared shape: input, validated result, declared errors, run-as
 * recipe, retry program, and the literal effect names its handler may use.
 */
export function normalizeReactionContract(
	value: RecordValue,
	normalizeCodec: (value: unknown) => unknown,
): RecordValue {
	if (typeof value.name !== "string")
		structural("reaction.name must be a string");
	// The controlled child evaluation serializes each Definition, so the inline
	// handler never reaches this contract. The generated factory type requires
	// it, and `validateRuntimeExecutableBindings` proves the bound bytes.
	const allowed = new Set([
		"__questpie",
		"effects",
		"errors",
		"handler",
		"input",
		"name",
		"output",
		"retry",
		"runAs",
	]);
	const unknown = Object.keys(value)
		.filter((key) => !allowed.has(key))
		.sort(compareAscii);
	if (unknown.length > 0)
		structural(`reaction.${unknown[0]} is outside the Reaction contract`);
	return {
		format: "questpie.reaction-definition-contract",
		version: 2,
		name: value.name,
		input: normalizeCodec(value.input),
		output: normalizeCodec(value.output),
		declaredErrors: normalizeDeclaredErrors(
			value.errors,
			"reaction",
			normalizeCodec,
		),
		runAs: normalizeRunAs(value.runAs),
		retry: normalizeRetry(value.retry),
		effects: normalizeEffects(value.effects),
		executableSlots: ["handler"],
	};
}

export interface ReactionProjectionV2 {
	readonly format: "questpie.reaction-projection";
	readonly version: 2;
	readonly reactions: readonly Readonly<{
		identity: string;
		input: unknown;
		output: unknown;
		declaredErrors: Readonly<Record<string, unknown>>;
		runAs: Readonly<{ actor: "caller"; whenDenied: "fail" }>;
		retry: Readonly<{
			maximumAttempts: number;
			initialDelayMilliseconds: number;
			backoff: "exponential";
			maximumDelayMilliseconds: number;
			jitter: "full";
			horizonMilliseconds: number;
		}>;
		effects: readonly string[];
		contractDigest: string;
		origin: Readonly<{
			path: string;
			exportName: string;
			packageId: string | null;
		}>;
	}>[];
}

/**
 * Projects the authored, static dispatch targets together with the run program
 * the durable kernel executes for each one.
 */
export function projectReactionContracts(
	resources: readonly NormalizedResource[],
): ReactionProjectionV2 {
	return Object.freeze({
		format: "questpie.reaction-projection" as const,
		version: 2 as const,
		reactions: Object.freeze(
			resources
				.filter((resource) => resource.kind === "reaction")
				.map((resource) =>
					Object.freeze({
						identity: resource.identity,
						input: resource.contract.input,
						output: resource.contract.output,
						declaredErrors: resource.contract.declaredErrors as Readonly<
							Record<string, unknown>
						>,
						runAs: resource.contract.runAs as Readonly<{
							actor: "caller";
							whenDenied: "fail";
						}>,
						retry: resource.contract
							.retry as ReactionProjectionV2["reactions"][number]["retry"],
						effects: resource.contract.effects as readonly string[],
						// The same executable contract digest the Runtime Build pins for
						// this handler slot, so a run and a worker compare one value.
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
				.sort((left, right) => compareAscii(left.identity, right.identity)),
		),
	});
}
