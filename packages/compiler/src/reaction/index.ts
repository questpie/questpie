import { compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { NormalizedResource } from "../types";

type RecordValue = Readonly<Record<string, unknown>>;

export function normalizeReactionContract(
	value: RecordValue,
	normalizeCodec: (value: unknown) => unknown,
): RecordValue {
	if (typeof value.name !== "string")
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			"reaction.name must be a string",
		);
	const allowed = new Set(["__questpie", "input", "name"]);
	const unknown = Object.keys(value)
		.filter((key) => !allowed.has(key))
		.sort(compareAscii);
	if (unknown.length > 0)
		throw new CompilerDiagnosticError(
			"QP-COMPOSE-013",
			"structuralTypeError",
			`reaction.${unknown[0]} is outside the BETA-06 static dispatch contract`,
		);
	return {
		format: "questpie.reaction-definition-contract",
		version: 1,
		name: value.name,
		input: normalizeCodec(value.input),
		executableSlots: [],
	};
}

export interface ReactionProjectionV1 {
	readonly format: "questpie.reaction-projection";
	readonly version: 1;
	readonly reactions: readonly Readonly<{
		identity: string;
		input: unknown;
		origin: Readonly<{
			path: string;
			exportName: string;
			packageId: string | null;
		}>;
	}>[];
}

/**
 * Projects the authored, static dispatch targets. Reaction execution is owned
 * by BETA-08; this projection deliberately contains no handler or run state.
 */
export function projectReactionContracts(
	resources: readonly NormalizedResource[],
): ReactionProjectionV1 {
	return Object.freeze({
		format: "questpie.reaction-projection" as const,
		version: 1 as const,
		reactions: Object.freeze(
			resources
				.filter((resource) => resource.kind === "reaction")
				.map((resource) =>
					Object.freeze({
						identity: resource.identity,
						input: resource.contract.input,
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
