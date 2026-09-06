export type CompositionDiagnosticCode =
	| "QP-COMPOSE-002"
	| "QP-COMPOSE-003"
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
	| "QP-COMPOSE-023"
	| "QP-COMPOSE-024"
	| "QP-COMPOSE-026"
	| "QP-COMPOSE-027"
	| "QP-COMPOSE-028"
	| "QP-COMPOSE-029"
	| "QP-COMPOSE-030"
	| "QP-DATA-003"
	| "QP-DATA-005"
	| "QP-DATA-008"
	| "QP-DATA-022"
	| "QP-DATA-023"
	| "QP-DATA-025"
	| "QP-DATA-026"
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

export function controlledEvaluationFailure(
	stderr: string,
): CompilerDiagnosticError {
	const decodeMarker = (value: string): string | null => {
		try {
			return decodeURIComponent(value);
		} catch {
			return null;
		}
	};
	const path = stderr.match(/QP-PATH ([A-Za-z0-9_.-]+)/)?.[1];
	const originMatch = stderr.match(
		/QP-ORIGIN ([A-Za-z0-9_.~%/-]+) ([A-Za-z0-9_.~%$-]+)/,
	);
	const originPath = originMatch ? decodeMarker(originMatch[1]!) : null;
	const originExport = originMatch ? decodeMarker(originMatch[2]!) : null;
	const details = {
		...(path ? { path } : {}),
		...(originPath !== null && originExport !== null
			? {
					origin: {
						path: originPath,
						exportName: originExport,
					},
				}
			: {}),
	};
	if (stderr.includes("QP-COMPOSE-002"))
		return new CompilerDiagnosticError(
			"QP-COMPOSE-002",
			"duplicateResourceIdentity",
			"controlled evaluation found a duplicate Resource identity",
		);
	if (stderr.includes("QP-COMPOSE-010"))
		return new CompilerDiagnosticError(
			"QP-COMPOSE-010",
			"impureStructuralGraph",
			"controlled child evaluation failed",
		);
	if (stderr.includes("QP-DATA-005"))
		return new CompilerDiagnosticError(
			"QP-DATA-005",
			"invalidOperator",
			"controlled relational evaluation found an unknown operator",
		);
	if (stderr.includes("QP-DATA-008")) return orderFieldNotSelected(details);
	if (stderr.includes("QP-DATA-022"))
		return new CompilerDiagnosticError(
			"QP-DATA-022",
			"relationDepthExceeded",
			"controlled relational evaluation exceeded the measured Relation depth",
			details,
		);
	if (stderr.includes("QP-DATA-025")) return unsupportedExpressionCapability();
	if (stderr.includes("QP-DATA-026")) return invalidInverseList(details);
	return new CompilerDiagnosticError(
		"QP-COMPOSE-013",
		"structuralTypeError",
		"controlled child evaluation failed",
		details,
	);
}

export function orderFieldNotSelected(
	details: Readonly<Record<string, unknown>> = {},
): CompilerDiagnosticError {
	return new CompilerDiagnosticError(
		"QP-DATA-008",
		"orderFieldNotSelected",
		"an order Field must be directly selected and eligible for cursor ordering",
		details,
	);
}

export function invalidInverseList(
	details: Readonly<Record<string, unknown>> = {},
): CompilerDiagnosticError {
	return new CompilerDiagnosticError(
		"QP-DATA-026",
		"invalidInverseList",
		"the inverse child list does not match the closed grammar",
		details,
	);
}

export function unsupportedExpressionCapability(): CompilerDiagnosticError {
	return new CompilerDiagnosticError(
		"QP-DATA-025",
		"unsupportedExpressionCapability",
		"expr.exists is Policy-only and cannot be used in Query filters",
		{ capability: "expr.exists" },
	);
}

const diagnosticClassesByCode = {
	"QP-COMPOSE-002": ["duplicateResourceIdentity"],
	"QP-COMPOSE-003": ["invalidResourceName"],
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
	"QP-COMPOSE-023": ["operationProjectionCollision"],
	"QP-COMPOSE-024": ["operationProjectionUnsafeName"],
	"QP-COMPOSE-026": [
		"unsupportedLifecycleSyntax",
		"lifecycleCapture",
		"unsupportedLifecycleCapability",
	],
	"QP-COMPOSE-027": [
		"invalidIssueDeclaration",
		"invalidIssueMapping",
		"missingIssueMapping",
	],
	"QP-COMPOSE-028": ["invalidHttpProjection"],
	"QP-COMPOSE-029": ["httpProjectionCollision"],
	"QP-COMPOSE-030": ["invalidDocumentation"],
	"QP-DATA-003": ["invalidRelationReference"],
	"QP-DATA-005": ["invalidOperator"],
	"QP-DATA-008": ["orderFieldNotSelected"],
	"QP-DATA-022": ["relationDepthExceeded"],
	"QP-DATA-023": ["databaseOwnedField"],
	"QP-DATA-025": ["unsupportedExpressionCapability"],
	"QP-DATA-026": ["invalidInverseList"],
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
