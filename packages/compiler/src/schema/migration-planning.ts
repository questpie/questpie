import type {
	MigrationPlanV1,
	RenameIdentityV1,
	SchemaProjectionV1,
} from "../schema";

export interface PlannedMigration {
	readonly status: "planned";
	readonly plan: MigrationPlanV1;
	readonly digest: string;
	readonly baseSchema: SchemaProjectionV1;
}

export interface NoChangesMigration {
	readonly status: "noChanges";
}

export type MigrationPlanningResult = PlannedMigration | NoChangesMigration;

export interface MigrationPlanInput {
	readonly targetSchema: SchemaProjectionV1;
	readonly baseSchema?: SchemaProjectionV1;
	readonly baseMigration?: string | null;
	readonly slug: string;
	readonly renames?: readonly Readonly<{
		from: RenameIdentityV1;
		to: RenameIdentityV1;
	}>[];
}
