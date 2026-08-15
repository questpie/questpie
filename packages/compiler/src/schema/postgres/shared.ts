import { CompilerDiagnosticError } from "../../diagnostic";
import type { CompilerDiagnosticArguments } from "../../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

export function fail(...args: CompilerDiagnosticArguments): never {
	throw new CompilerDiagnosticError(...args);
}

export function childRecords(
	collection: JsonRecord,
	key: string,
): readonly JsonRecord[] {
	const value = collection[key];
	return Array.isArray(value) ? (value as readonly JsonRecord[]) : [];
}
