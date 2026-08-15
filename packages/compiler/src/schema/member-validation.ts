import { CompilerDiagnosticError } from "../diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

export function reservePostgresRelationName(
	names: Map<string, string>,
	name: string,
	identity: string,
): void {
	const previous = names.get(name);
	if (previous)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-006",
			"physicalNameCollision",
			`${previous} and ${identity} share ${name}`,
		);
	names.set(name, identity);
}

export function validateBtreeIndexTerms<
	Term extends Readonly<{ field: string }>,
>(
	indexIdentity: string,
	terms: readonly Term[],
	fields: readonly RecordValue[],
): readonly Term[] {
	if (terms.length === 0)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${indexIdentity} requires at least one Field`,
		);

	const fieldsByIdentity = new Map(
		fields.map((field) => [String(field.identity), field]),
	);
	for (const term of terms) {
		const field = fieldsByIdentity.get(term.field);
		if (!field)
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-003",
				"invalidReference",
				`${indexIdentity} references unknown ${term.field}`,
			);
		const type = field.type as RecordValue;
		if (type.kind === "object" || type.kind === "array" || type.kind === "json")
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-003",
				"invalidReference",
				`${indexIdentity} cannot index JSON-backed ${term.field}`,
			);
	}
	return terms;
}

export function validateKeyConstraintFields(
	constraintIdentity: string,
	references: readonly string[],
	fields: readonly RecordValue[],
): readonly string[] {
	if (references.length === 0)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-001",
			"invalidDefinition",
			`${constraintIdentity} requires at least one Field`,
		);
	const knownFields = new Set(fields.map((field) => String(field.identity)));
	for (const reference of references)
		if (!knownFields.has(reference))
			throw new CompilerDiagnosticError(
				"QP-SCHEMA-003",
				"invalidReference",
				`${constraintIdentity} references unknown ${reference}`,
			);
	return references;
}
