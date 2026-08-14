export type CompositionDiagnosticCode =
	| "QP-COMPOSE-002"
	| "QP-COMPOSE-005"
	| "QP-COMPOSE-006"
	| "QP-COMPOSE-008"
	| "QP-COMPOSE-011"
	| "QP-COMPOSE-012"
	| "QP-COMPOSE-013"
	| "QP-COMPOSE-014"
	| "QP-COMPOSE-015"
	| "QP-COMPOSE-017"
	| "QP-COMPOSE-020";

export class CompilerDiagnosticError extends Error {
	readonly code: CompositionDiagnosticCode;
	readonly diagnosticClass: string;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(
		code: CompositionDiagnosticCode,
		diagnosticClass: string,
		message: string,
		details: Readonly<Record<string, unknown>> = {},
	) {
		super(`${code} ${diagnosticClass}: ${message}`);
		this.name = "CompilerDiagnosticError";
		this.code = code;
		this.diagnosticClass = diagnosticClass;
		this.details = details;
	}
}
