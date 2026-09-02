export type DataQueryDiagnosticCode =
	| "QP-DATA-001"
	| "QP-DATA-006"
	| "QP-DATA-012"
	| "QP-DATA-014";

const diagnosticClasses = {
	"QP-DATA-001": "invalidScalarValue",
	"QP-DATA-006": "invalidSetOperand",
	"QP-DATA-012": "executionLimitExceeded",
	"QP-DATA-014": "invalidParameterReference",
} as const;

export class DataQueryExecutionError extends Error {
	readonly blocking = "none" as const;
	readonly diagnosticClass: (typeof diagnosticClasses)[DataQueryDiagnosticCode];

	constructor(
		readonly code: DataQueryDiagnosticCode,
		readonly phase: "bind" | "execute",
	) {
		const diagnosticClass = diagnosticClasses[code];
		super(diagnosticClass);
		this.name = "DataQueryExecutionError";
		this.diagnosticClass = diagnosticClass;
	}
}
