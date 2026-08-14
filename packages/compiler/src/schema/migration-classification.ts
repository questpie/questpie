export type MigrationClassification =
	| "safe"
	| "guarded"
	| "destructive"
	| "blocked";

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
