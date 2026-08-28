import type { ScalarCodecV1 } from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";

export type PostgresOperationParameterV1 = Readonly<{
	position: number;
	postgresType: string;
}> &
	(
		| Readonly<{
				kind: "callerInput" | "key" | "patchValue" | "trustedValue";
				path: readonly string[];
				codec: ScalarCodecV1;
		  }>
		| Readonly<{
				kind: "patchPresent" | "trustedValuePresent";
				path: readonly string[];
				codec: "boolean";
		  }>
		| Readonly<{
				kind: "executionFact";
				source: string;
				path: readonly string[];
				codec: string;
		  }>
		| Readonly<{
				kind: "literal";
				value: null | boolean | number | string;
				codec: string;
		  }>
	);

export interface PostgresOperationResultV1 {
	readonly path: readonly string[];
	readonly column: string;
	readonly codec: ScalarCodecV1;
	readonly nullable: boolean;
	readonly guardColumn?: string;
}

export interface PostgresGetOperationPlanV1 {
	readonly identity: CollectionOperationProgramV1["identity"];
	readonly target: CollectionOperationProgramV1["target"];
	readonly member: "get";
	readonly policy: CollectionOperationProgramV1["policy"];
	readonly outputCardinality: "optionalOne";
	readonly consistency: Readonly<{
		standalone: "readSnapshot";
		nestedMutation: "keyedLockThenFreshPolicyRead";
	}>;
	readonly lifecycle: readonly [
		"keyedRowLock",
		"freshPolicyRead",
		"selection",
		"outputFieldAuthority",
	];
	readonly lock: Readonly<{
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		outcome: "internalLockedOrAbsent";
	}>;
	readonly read: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		result: readonly PostgresOperationResultV1[];
	}>;
	readonly outputAuthority: Readonly<{
		freshAfterRowLockWait: true;
		selectedPaths: readonly Readonly<{
			path: readonly string[];
			conditional: boolean;
			guardColumn?: string;
			mutableEvidenceCollections: readonly `collection:${string}`[];
		}>[];
	}>;
	readonly limits: Readonly<{ rows: 1; durationMilliseconds: number }>;
}

export interface PostgresCreateOperationPlanV1 {
	readonly identity: CollectionOperationProgramV1["identity"];
	readonly target: CollectionOperationProgramV1["target"];
	readonly member: "create";
	readonly policy: CollectionOperationProgramV1["policy"];
	readonly outputCardinality: "one";
	readonly lifecycle: readonly [
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"schemaDefaults",
		"serverValues",
		"completeCandidateValidation",
		"candidatePolicy",
		"postgresConstraints",
		"selection",
		"outputFieldAuthority",
		"outputValidation",
	];
	readonly normalizerProgram: Readonly<Record<string, unknown>> | null;
	readonly serverValueProgram: Readonly<Record<string, unknown>> | null;
	readonly candidate: Readonly<{
		steps: readonly Readonly<Record<string, unknown>>[];
		fields: readonly Readonly<{
			path: readonly string[];
			codec: ScalarCodecV1;
			nullable: boolean;
		}>[];
	}>;
	readonly fieldAuthority: Readonly<{
		suppliedPathsOnly: true;
		checks: readonly Readonly<{
			path: readonly string[];
			sql: string;
			parameters: readonly PostgresOperationParameterV1[];
		}>[];
	}>;
	readonly candidatePolicy: Readonly<{
		freshAfterRowLockWait: true;
		mutableEvidenceCollections: readonly `collection:${string}`[];
		sql: string;
	}>;
	readonly outputAuthority: Readonly<{
		freshAfterRowLockWait: true;
		selectedPaths: readonly Readonly<{
			path: readonly string[];
			conditional: boolean;
			guardColumn?: string;
			mutableEvidenceCollections: readonly `collection:${string}`[];
		}>[];
	}>;
	readonly write: Readonly<{
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		result: readonly PostgresOperationResultV1[];
	}>;
	readonly limits: Readonly<{ rows: number; durationMilliseconds: number }>;
}

export interface PostgresUpdateOperationPlanV1 {
	readonly identity: CollectionOperationProgramV1["identity"];
	readonly target: CollectionOperationProgramV1["target"];
	readonly member: "update";
	readonly policy: CollectionOperationProgramV1["policy"];
	readonly outputCardinality: "optionalOne";
	readonly lifecycle: readonly [
		"keyedRowLock",
		"freshCurrentPolicy",
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"serverValues",
		"completeCandidateValidation",
		"candidatePolicy",
		"postgresConstraints",
		"selection",
		"outputFieldAuthority",
		"outputValidation",
	];
	readonly normalizerProgram: Readonly<Record<string, unknown>> | null;
	readonly serverValueProgram: Readonly<Record<string, unknown>> | null;
	readonly candidate: PostgresCreateOperationPlanV1["candidate"];
	readonly lock: PostgresGetOperationPlanV1["lock"];
	readonly fieldAuthority: PostgresCreateOperationPlanV1["fieldAuthority"];
	readonly currentPolicy: PostgresCreateOperationPlanV1["candidatePolicy"];
	readonly candidatePolicy: PostgresCreateOperationPlanV1["candidatePolicy"];
	readonly outputAuthority: PostgresCreateOperationPlanV1["outputAuthority"];
	readonly write: PostgresCreateOperationPlanV1["write"];
	readonly limits: Readonly<{ rows: number; durationMilliseconds: number }>;
}

export interface PostgresCollectionOperationPlansV1 {
	readonly format: "questpie.postgres-collection-operation-plans";
	readonly version: 1;
	readonly plans: readonly (
		| PostgresCreateOperationPlanV1
		| PostgresGetOperationPlanV1
		| PostgresUpdateOperationPlanV1
	)[];
	readonly digest: string;
}
