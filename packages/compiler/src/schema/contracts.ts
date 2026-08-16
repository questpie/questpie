import type { MigrationClassification } from "./migration-classification";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface SchemaProjectionV1 extends JsonRecord {
	readonly format: "questpie.schema-projection";
	readonly version: 1;
	readonly application: Readonly<{ name: string; postgresSchema: string }>;
	readonly requiredPostgres: Readonly<{
		minimumMajor: number;
		databaseCollation: string;
		databaseCType: string;
		extensions: readonly Readonly<{ name: string }>[];
	}>;
	readonly collections: readonly JsonRecord[];
}

export type RenameIdentityV1 =
	| `collection:${string}`
	| `collection:${string}/field:${string}`;

export type MigrationStepKindV1 =
	| "createApplicationSchema"
	| "renameCollection"
	| "createCollection"
	| "renameField"
	| "renameConstraint"
	| "renameRelationConstraint"
	| "renameIndex"
	| "addField"
	| "alterField"
	| "addConstraint"
	| "addRelation"
	| "addIndex"
	| "addChangeCapture"
	| "dropChangeCapture"
	| "dropIndex"
	| "dropRelation"
	| "dropConstraint"
	| "dropField"
	| "dropCollection";

export interface MigrationStepV1 extends JsonRecord {
	readonly stepId: string;
	readonly kind: MigrationStepKindV1;
	readonly targetIdentity: string;
	readonly containerIdentity: string;
	readonly lock:
		| "none"
		| "share"
		| "shareRowExclusive"
		| "shareUpdateExclusive"
		| "accessExclusive";
	readonly scansData: boolean;
	readonly rewritesTable: boolean;
	readonly reversibleWithoutData: boolean;
	readonly classification: MigrationClassification;
}

export interface MigrationPlanV1 extends JsonRecord {
	readonly format: "questpie.migration-plan";
	readonly version: 1;
	readonly application: string;
	readonly slug: string;
	readonly baseMigration: string | null;
	readonly baseSchemaDigest: string;
	readonly targetSchemaDigest: string;
	readonly renames: readonly Readonly<{
		from: RenameIdentityV1;
		to: RenameIdentityV1;
	}>[];
	readonly requiredPostgres: SchemaProjectionV1["requiredPostgres"];
	readonly classification: MigrationClassification;
	readonly steps: readonly MigrationStepV1[];
}

export interface CommittedMigration {
	readonly identity: string;
	readonly checksum: string;
	readonly plan: MigrationPlanV1;
	readonly baseSchema: SchemaProjectionV1;
	readonly targetSchema: SchemaProjectionV1;
	readonly files: CommittedMigrationFilesV1;
}

export interface CommittedMigrationFilesV1 {
	readonly "migration.json": string;
	readonly "plan.json": string;
	readonly "base-schema.json": string;
	readonly "target-schema.json": string;
	readonly "up.sql": string;
	readonly "checksum.sha256": string;
}
