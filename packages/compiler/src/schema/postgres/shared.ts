import { CompilerDiagnosticError } from "../../diagnostic";
import type { SchemaFingerprintV1 } from "../postgres-types";

type JsonRecord = Readonly<Record<string, unknown>>;

type ProviderObservations = SchemaFingerprintV1["observations"];

export function fail(
	code: ConstructorParameters<typeof CompilerDiagnosticError>[0],
	diagnosticClass: string,
	message: string,
	details: Readonly<Record<string, unknown>> = {},
): never {
	throw new CompilerDiagnosticError(code, diagnosticClass, message, details);
}

export function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}
