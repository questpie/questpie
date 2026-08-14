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

export interface ChangedFieldClassification {
	readonly classification: MigrationClassification;
	readonly effect: "none" | "alterField";
}

export class GeneratedInvariantClassifications {
	readonly #fields = new Map<string, MigrationClassification>();

	classify(
		base: FieldShape,
		target: FieldShape,
	): ChangedFieldClassification | null {
		const change = classifyChangedField(base, target);
		if (!change) return null;
		this.#fields.set(String(base.identity), change.classification);
		this.#fields.set(String(target.identity), change.classification);
		return change;
	}

	forConstraint(
		identity: string,
		fallback: MigrationClassification,
	): MigrationClassification {
		const marker = "/invariant:";
		const index = identity.lastIndexOf(marker);
		if (index === -1) return fallback;
		return this.#fields.get(identity.slice(0, index)) ?? fallback;
	}
}

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
): ChangedFieldClassification | null {
	const changes: ChangedFieldClassification[] = [];
	const baseType = base.type as FieldShape;
	const targetType = target.type as FieldShape;
	if (canonicalBytes(baseType) !== canonicalBytes(targetType)) {
		const supportedTypeDelta =
			classifyValidatorBounds(baseType, targetType) ??
			classifyNumericStorage(baseType, targetType);
		changes.push(
			supportedTypeDelta ?? {
				classification:
					baseType.kind === "integer" && targetType.kind === "bigint"
						? "guarded"
						: "blocked",
				effect: "alterField",
			},
		);
	}
	if (base.nullable !== target.nullable)
		changes.push({
			classification:
				base.nullable === false && target.nullable === true
					? "destructive"
					: literalDefault(target.default)
						? "destructive"
						: "blocked",
			effect: "alterField",
		});
	if (canonicalBytes(base.default) !== canonicalBytes(target.default)) {
		if (base.default === null)
			changes.push({
				classification: literalDefault(target.default) ? "guarded" : "blocked",
				effect: "alterField",
			});
		else changes.push({ classification: "destructive", effect: "alterField" });
	}
	if (
		canonicalBytes(fieldRemainder(base)) !==
		canonicalBytes(fieldRemainder(target))
	)
		changes.push({ classification: "blocked", effect: "alterField" });
	if (changes.length === 0) return null;
	return {
		classification: maximumClassification(changes),
		effect: changes.some((change) => change.effect === "alterField")
			? "alterField"
			: "none",
	};
}

function classifyValidatorBounds(
	base: FieldShape,
	target: FieldShape,
): ChangedFieldClassification | null {
	if (base.kind !== target.kind) return null;
	const bounds =
		base.kind === "text"
			? (["minLength", "maxLength"] as const)
			: base.kind === "integer" || base.kind === "bigint"
				? (["minimum", "maximum"] as const)
				: null;
	if (!bounds) return null;
	const stableBase = { ...base };
	const stableTarget = { ...target };
	for (const bound of bounds) {
		delete stableBase[bound];
		delete stableTarget[bound];
	}
	if (canonicalBytes(stableBase) !== canonicalBytes(stableTarget))
		return { classification: "blocked", effect: "alterField" };
	const classifications: MigrationClassification[] = [];
	for (const bound of bounds) {
		if (base[bound] === target[bound]) continue;
		const before = base[bound] as number | string | null;
		const after = target[bound] as number | string | null;
		const comparison =
			before === null || after === null
				? null
				: compareBound(base.kind, before, after);
		const isMinimum = bound === "minLength" || bound === "minimum";
		const relaxes =
			after === null ||
			(before !== null &&
				comparison !== null &&
				(isMinimum ? comparison < 0 : comparison > 0));
		classifications.push(relaxes ? "safe" : "destructive");
	}
	if (classifications.length === 0) return null;
	return {
		classification: maximumClassification(
			classifications.map((classification) => ({ classification })),
		),
		effect: "none",
	};
}

function compareBound(
	kind: unknown,
	before: number | string,
	after: number | string,
): number {
	const left = kind === "bigint" ? BigInt(before) : Number(before);
	const right = kind === "bigint" ? BigInt(after) : Number(after);
	return right < left ? -1 : right > left ? 1 : 0;
}

function classifyNumericStorage(
	base: FieldShape,
	target: FieldShape,
): ChangedFieldClassification | null {
	if (base.kind !== "numeric" || target.kind !== "numeric") return null;
	const destructive =
		base.scale !== target.scale ||
		Number(target.precision) < Number(base.precision);
	return {
		classification: destructive ? "destructive" : "safe",
		effect: "alterField",
	};
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
