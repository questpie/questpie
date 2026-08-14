import { canonicalBytes } from "../canonical";

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

export function classifyAddedField(
	field: Readonly<{ nullable?: unknown; default?: unknown }>,
): MigrationClassification {
	if (field.default === null)
		return field.nullable === true ? "safe" : "blocked";
	const literal =
		field.default !== null &&
		typeof field.default === "object" &&
		"kind" in field.default &&
		field.default.kind === "literal";
	if (!literal) return "blocked";
	return field.nullable === true ? "guarded" : "destructive";
}

type FieldShape = Readonly<Record<string, unknown>>;

function literalDefault(value: unknown): boolean {
	return (
		value !== null &&
		typeof value === "object" &&
		"kind" in value &&
		value.kind === "literal"
	);
}

function fieldRemainder(field: FieldShape): Readonly<Record<string, unknown>> {
	const {
		default: _default,
		identity: _identity,
		nullable: _nullable,
		path: _path,
		postgresName: _postgresName,
		type: _type,
		...remainder
	} = field;
	return remainder;
}

export function classifyChangedField(
	base: FieldShape,
	target: FieldShape,
): MigrationClassification | null {
	const classifications: MigrationClassification[] = [];
	const baseType = base.type as FieldShape;
	const targetType = target.type as FieldShape;
	if (canonicalBytes(baseType) !== canonicalBytes(targetType))
		classifications.push(
			baseType.kind === "integer" && targetType.kind === "bigint"
				? "guarded"
				: "blocked",
		);
	if (base.nullable !== target.nullable)
		classifications.push(
			base.nullable === false && target.nullable === true
				? "destructive"
				: literalDefault(target.default)
					? "destructive"
					: "blocked",
		);
	if (canonicalBytes(base.default) !== canonicalBytes(target.default)) {
		if (base.default === null)
			classifications.push(
				literalDefault(target.default) ? "guarded" : "blocked",
			);
		else classifications.push("destructive");
	}
	if (
		canonicalBytes(fieldRemainder(base)) !==
		canonicalBytes(fieldRemainder(target))
	)
		classifications.push("blocked");
	if (classifications.length === 0) return null;
	return maximumClassification(
		classifications.map((classification) => ({ classification })),
	);
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
