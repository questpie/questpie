export type CompositionDiagnosticCode =
	| "QP-COMPOSE-002"
	| "QP-COMPOSE-005"
	| "QP-COMPOSE-006"
	| "QP-COMPOSE-008"
	| "QP-COMPOSE-010"
	| "QP-COMPOSE-011"
	| "QP-COMPOSE-012"
	| "QP-COMPOSE-013"
	| "QP-COMPOSE-014"
	| "QP-COMPOSE-015"
	| "QP-COMPOSE-017"
	| "QP-COMPOSE-020"
	| "QP-SCHEMA-001"
	| "QP-SCHEMA-002"
	| "QP-SCHEMA-003"
	| "QP-SCHEMA-004"
	| "QP-SCHEMA-005"
	| "QP-SCHEMA-006"
	| "QP-SCHEMA-007"
	| "QP-SCHEMA-020"
	| "QP-SCHEMA-021"
	| "QP-SCHEMA-022"
	| "QP-SCHEMA-023"
	| "QP-SCHEMA-024"
	| "QP-SCHEMA-025"
	| "QP-SCHEMA-026"
	| "QP-SCHEMA-027"
	| "QP-SCHEMA-028"
	| "QP-SCHEMA-029"
	| "QP-SCHEMA-031"
	| "QP-SEED-001"
	| "QP-SEED-002"
	| "QP-SEED-003"
	| "QP-SEED-004"
	| "QP-SEED-009"
	| "QP-SEED-011"
	| "QP-SEED-012"
	| "QP-SEED-014";

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
