import { canonicalBytes, compareAscii } from "../canonical";
import { CompilerDiagnosticError } from "../diagnostic";

export type RecordValue = Readonly<Record<string, unknown>>;

export function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

export function string(value: unknown, label: string): string {
	if (typeof value !== "string")
		throw new TypeError(`${label} must be a string`);
	return value;
}

export function array(value: unknown, label: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
	return value;
}

export function cloneJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(cloneJson);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
		);
	return value;
}

export function compareCanonical(left: unknown, right: unknown): number {
	return compareAscii(canonicalBytes(left), canonicalBytes(right));
}

export function invalidOperator(operator: unknown): never {
	throw new CompilerDiagnosticError(
		"QP-DATA-005",
		"invalidOperator",
		`unsupported relational operator ${String(operator)}`,
		{ operator },
	);
}
