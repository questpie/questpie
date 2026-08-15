import { digest } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";
import type { CompilerDiagnosticArguments } from "../diagnostic";
import type { MigrationPlanV1, SchemaProjectionV1 } from "./contracts";

type JsonRecord = Readonly<Record<string, unknown>>;

export function schemaError(...args: CompilerDiagnosticArguments): never {
	throw new CompilerDiagnosticError(...args);
}

export function assertProjection(
	value: unknown,
	label: string,
): SchemaProjectionV1 {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${label} is not an object`,
		);
	const projection = value as SchemaProjectionV1;
	if (
		projection.format !== "questpie.schema-projection" ||
		projection.version !== 1 ||
		!projection.application ||
		!projection.requiredPostgres ||
		!Array.isArray(projection.collections)
	)
		return schemaError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${label} is not a Schema Projection v1`,
		);
	return projection;
}

export function mapByIdentity(
	values: readonly JsonRecord[],
	label: string,
): Map<string, JsonRecord> {
	const mapped = new Map<string, JsonRecord>();
	for (const value of values) {
		const identity = value.identity;
		if (typeof identity !== "string")
			return schemaError(
				"QP-SCHEMA-001",
				"invalidDefinition",
				`${label} identity is missing`,
			);
		if (mapped.has(identity))
			return schemaError(
				"QP-SCHEMA-002",
				"duplicateIdentity",
				`${identity} is duplicated`,
			);
		mapped.set(identity, value);
	}
	return mapped;
}

export function schemaDigest(schema: SchemaProjectionV1): string {
	return digest("questpie-schema-projection-v1", schema);
}

export function genesis(target: SchemaProjectionV1): SchemaProjectionV1 {
	return {
		format: "questpie.schema-projection",
		version: 1,
		application: target.application,
		requiredPostgres: target.requiredPostgres,
		collections: [],
	};
}

export function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}

export function mapIdentityForward(
	identity: string,
	renames: MigrationPlanV1["renames"],
): string {
	const mapping = [...renames]
		.sort((left, right) => right.from.length - left.from.length)
		.find(
			(candidate) =>
				identity === candidate.from ||
				identity.startsWith(`${candidate.from}/`),
		);
	return mapping
		? `${mapping.to}${identity.slice(mapping.from.length)}`
		: identity;
}

export function mapIdentityBackward(
	identity: string,
	renames: MigrationPlanV1["renames"],
): string {
	const mapping = [...renames]
		.sort((left, right) => right.to.length - left.to.length)
		.find(
			(candidate) =>
				identity === candidate.to || identity.startsWith(`${candidate.to}/`),
		);
	return mapping
		? `${mapping.from}${identity.slice(mapping.to.length)}`
		: identity;
}
