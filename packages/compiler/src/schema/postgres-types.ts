import type { CompositionDiagnosticCode } from "../diagnostic";

type JsonRecord = Readonly<Record<string, unknown>>;

type SchemaDiagnosticCode = Extract<
	CompositionDiagnosticCode,
	`QP-SCHEMA-${string}`
>;

type SchemaDiagnosticClass =
	| "invalidDefinition"
	| "duplicateIdentity"
	| "invalidReference"
	| "unsupportedDefinition"
	| "invalidPhysicalName"
	| "physicalNameCollision"
	| "providerMismatch"
	| "destructiveAcknowledgementRequired"
	| "planDigestMismatch"
	| "stalePlan"
	| "checksumMismatch"
	| "missingLocalMigration"
	| "pendingMigration"
	| "unknownAppliedMigration"
	| "orderMismatch"
	| "applicationBindingMismatch"
	| "baseDrift"
	| "targetDrift"
	| "missingObject"
	| "unexpectedObject"
	| "changedObject"
	| "invalidObject"
	| "undeclaredDependency"
	| "unplannedDesiredChange"
	| "unsupportedPostgres"
	| "missingExtension"
	| "incompatibleExtension"
	| "nonTransactionalDdl";

type CanonicalJsonValue =
	| null
	| boolean
	| number
	| string
	| readonly CanonicalJsonValue[]
	| Readonly<{ [key: string]: CanonicalJsonValue }>;

interface SourceSpanV1 {
	readonly start: Readonly<{ line: number; column: number }>;
	readonly end: Readonly<{ line: number; column: number }>;
}

interface SourceLocationV1 {
	readonly packageId: string | null;
	readonly path: string;
	readonly span: SourceSpanV1 | null;
}

type ConstructedOriginV1 =
	| Readonly<{
			kind: "export";
			packageId: string | null;
			path: string;
			exportName: string;
			span: SourceSpanV1 | null;
			declaredAt: Readonly<{
				packageId: string;
				path: string;
				exportName: string;
				span: SourceSpanV1 | null;
			}> | null;
	  }>
	| Readonly<{ kind: "callSite"; location: SourceLocationV1 }>;

export interface SchemaDiagnosticV1 {
	readonly format: "questpie.diagnostic";
	readonly version: 1;
	readonly code: SchemaDiagnosticCode;
	readonly class: SchemaDiagnosticClass;
	readonly severity: "error";
	readonly blocking: "deploy" | "fatal";
	readonly identity: string | null;
	readonly origins: readonly ConstructedOriginV1[];
	readonly summary: string;
	readonly expected: CanonicalJsonValue | null;
	readonly actual: CanonicalJsonValue | null;
	readonly recovery: readonly Readonly<{
		description: string;
		command: string | null;
	}>[];
	readonly comparison:
		| "localToReceipts"
		| "appliedToDatabase"
		| "desiredToCommitted"
		| "provider"
		| null;
	readonly physicalName: string | null;
	readonly containerIdentity:
		| `application:${string}`
		| `collection:${string}`
		| null;
}

export interface PostgresSqlstateDiagnostic {
	readonly sqlstate: string | null;
}

export interface SchemaFingerprintV1 extends JsonRecord {
	readonly format: "questpie.schema-fingerprint";
	readonly version: 1;
	readonly comparable: JsonRecord;
	readonly observations: Readonly<{
		serverVersion: string;
		databaseCollation: string;
		databaseCType: string;
		databaseEncoding: string;
		binaryCollationProvider: string;
		binaryCollationDeterministic: boolean;
		extensions: readonly Readonly<{
			name: string;
			installedVersion: string;
		}>[];
	}>;
}

export interface ApplyMigrationsSuccess {
	readonly status: "applied" | "alreadyApplied";
	readonly applied: readonly string[];
	readonly head: string;
	readonly fingerprintDigest: string;
}

export interface ApplyMigrationsFailure {
	readonly status: "failed";
	readonly exitCode: 4 | 5;
	readonly applied: readonly string[];
	readonly failed: string;
	readonly diagnostic: SchemaDiagnosticV1 | PostgresSqlstateDiagnostic;
	readonly remaining: readonly string[];
}

export type ApplyMigrationsResult =
	| ApplyMigrationsSuccess
	| ApplyMigrationsFailure;
