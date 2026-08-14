export type MigrationClassification =
	| "safe"
	| "guarded"
	| "destructive"
	| "blocked";

export interface PostgresRequirementProfile {
	readonly minimumMajor: number;
	readonly databaseCollation: string;
	readonly databaseCType: string;
	readonly extensions: readonly Readonly<{ name: string }>[];
}

export function classifyProviderDelta(
	base: PostgresRequirementProfile,
	target: PostgresRequirementProfile,
): MigrationClassification | null {
	if (
		base.databaseCollation !== target.databaseCollation ||
		base.databaseCType !== target.databaseCType
	)
		return "blocked";
	const baseExtensions = new Set(base.extensions.map((item) => item.name));
	const targetExtensions = new Set(target.extensions.map((item) => item.name));
	const addsRequirement =
		target.minimumMajor > base.minimumMajor ||
		[...targetExtensions].some((name) => !baseExtensions.has(name));
	if (addsRequirement) return "guarded";
	const removesRequirement =
		target.minimumMajor < base.minimumMajor ||
		[...baseExtensions].some((name) => !targetExtensions.has(name));
	return removesRequirement ? "safe" : null;
}

const severity: Readonly<Record<MigrationClassification, number>> = {
	safe: 0,
	guarded: 1,
	destructive: 2,
	blocked: 3,
};

export function maximumClassification(
	steps: readonly Readonly<{ classification: MigrationClassification }>[],
): MigrationClassification {
	let result: MigrationClassification = "safe";
	for (const step of steps)
		if (severity[step.classification] > severity[result])
			result = step.classification;
	return result;
}
