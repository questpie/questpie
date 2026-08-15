import { CompilerDiagnosticError } from "../diagnostic";

type RecordValue = Readonly<Record<string, unknown>>;

export function fieldPath(value: unknown): readonly string[] {
	if (typeof value === "string") return [value];
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.some((segment) => typeof segment !== "string")
	)
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-003",
			"invalidReference",
			"a Field reference must be a string or non-empty segment array",
		);
	return value as readonly string[];
}

export function indexField(value: unknown): Readonly<{
	field: readonly string[];
	order: "asc" | "desc";
	nulls: "first" | "last";
}> {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { field: fieldPath(value), order: "asc", nulls: "last" };
	const input = value as RecordValue;
	const order = input.order === "desc" ? "desc" : "asc";
	return {
		field: fieldPath(input.field),
		order,
		nulls:
			input.nulls === "first" || input.nulls === "last"
				? input.nulls
				: order === "desc"
					? "first"
					: "last",
	};
}
