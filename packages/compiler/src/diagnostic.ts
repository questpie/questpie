export type CompositionDiagnosticCode =
	| "QP-COMPOSE-002"
	| "QP-COMPOSE-004"
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
	| "QP-DATA-003"
	| "QP-DATA-005"
	| "QP-POLICY-001"
	| "QP-POLICY-002"
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

const diagnosticClassesByCode = {
	"QP-COMPOSE-002": ["duplicateResourceIdentity"],
	"QP-COMPOSE-004": ["unknownReference"],
	"QP-COMPOSE-005": ["packageCompositionNotActivated"],
	"QP-COMPOSE-006": ["invalidPackageManifest"],
	"QP-COMPOSE-008": ["packageInventoryChanged"],
	"QP-COMPOSE-010": ["impureStructuralGraph"],
	"QP-COMPOSE-011": ["nondeterministicEvaluation"],
	"QP-COMPOSE-012": ["structuralImportOfGeneratedOutput"],
	"QP-COMPOSE-013": ["structuralTypeError"],
	"QP-COMPOSE-014": ["augmentationMemberCollision"],
	"QP-COMPOSE-015": ["invalidAugmentation"],
	"QP-COMPOSE-017": ["invalidApplicationRoot"],
	"QP-COMPOSE-020": ["duplicateContributionIdentity"],
	"QP-DATA-003": ["invalidRelationReference"],
	"QP-DATA-005": ["invalidOperator"],
	"QP-POLICY-001": ["missingDefaultPolicy"],
	"QP-POLICY-002": ["ambiguousDefaultPolicy"],
	"QP-SCHEMA-001": ["invalidDefinition"],
	"QP-SCHEMA-002": ["duplicateIdentity"],
	"QP-SCHEMA-003": ["invalidReference"],
	"QP-SCHEMA-004": ["unsupportedDefinition"],
	"QP-SCHEMA-005": ["invalidPhysicalName"],
	"QP-SCHEMA-006": ["physicalNameCollision"],
	"QP-SCHEMA-007": [
		"providerMismatch",
		"unsupportedPostgres",
		"missingExtension",
		"incompatibleExtension",
	],
	"QP-SCHEMA-020": ["destructiveAcknowledgementRequired"],
	"QP-SCHEMA-021": ["planDigestMismatch"],
	"QP-SCHEMA-022": ["stalePlan"],
	"QP-SCHEMA-023": ["checksumMismatch"],
	"QP-SCHEMA-024": ["missingLocalMigration", "unknownAppliedMigration"],
	"QP-SCHEMA-025": ["orderMismatch"],
	"QP-SCHEMA-026": ["baseDrift"],
	"QP-SCHEMA-027": ["targetDrift"],
	"QP-SCHEMA-028": [
		"missingObject",
		"unexpectedObject",
		"changedObject",
		"invalidObject",
	],
	"QP-SCHEMA-029": ["applicationBindingMismatch"],
	"QP-SCHEMA-031": ["nonTransactionalDdl"],
	"QP-SEED-001": ["missingSeedDependency"],
	"QP-SEED-002": ["seedDependencyCycle"],
	"QP-SEED-003": ["seedTargetMismatch"],
	"QP-SEED-004": ["checksumMismatch"],
	"QP-SEED-009": ["unsupportedSeedStep"],
	"QP-SEED-011": ["seedInsertConflict"],
	"QP-SEED-012": ["seedCardinalityMismatch"],
	"QP-SEED-014": ["seedSchemaDrift"],
} as const satisfies Readonly<
	Record<CompositionDiagnosticCode, readonly string[]>
>;

export type DiagnosticClassForCode<Code extends CompositionDiagnosticCode> =
	(typeof diagnosticClassesByCode)[Code][number];

type DiagnosticArgumentsByCode = {
	[Code in CompositionDiagnosticCode]: [
		code: Code,
		diagnosticClass: DiagnosticClassForCode<Code>,
		message: string,
		details?: Readonly<Record<string, unknown>>,
	];
};

export type CompilerDiagnosticArguments =
	DiagnosticArgumentsByCode[CompositionDiagnosticCode];

export function isDiagnosticClassForCode<
	Code extends CompositionDiagnosticCode,
>(
	code: Code,
	diagnosticClass: string,
): diagnosticClass is DiagnosticClassForCode<Code> {
	return (diagnosticClassesByCode[code] as readonly string[]).includes(
		diagnosticClass,
	);
}

export class CompilerDiagnosticError extends Error {
	readonly code: CompositionDiagnosticCode;
	readonly diagnosticClass: DiagnosticClassForCode<CompositionDiagnosticCode>;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(...args: CompilerDiagnosticArguments) {
		const [code, diagnosticClass, message, details = {}] = args;
		if (!isDiagnosticClassForCode(code, diagnosticClass))
			throw new TypeError(
				`invalid diagnostic code and class pair: ${code} ${diagnosticClass}`,
			);
		super(`${code} ${diagnosticClass}: ${message}`);
		this.name = "CompilerDiagnosticError";
		this.code = code;
		this.diagnosticClass = diagnosticClass;
		this.details = details;
	}
}
