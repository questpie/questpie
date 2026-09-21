import type { PostgresMutationFieldCodecV1 } from "../relational";
import type { CollectionOperationProgramV1 } from "./operation-set-contract";

export type PostgresOperationParameterV1 = Readonly<{
	position: number;
	postgresType: string;
}> &
	(
		| Readonly<{
				kind:
					| "callerInput"
					| "key"
					| "patchValue"
					| "trustedValue"
					| "expectedValue"
					| "candidateValue";
				path: readonly string[];
				codec: PostgresMutationFieldCodecV1;
		  }>
		| Readonly<{
				kind:
					| "callerInputPresent"
					| "patchPresent"
					| "trustedValuePresent"
					| "expectedPresent";
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
	readonly codec: PostgresMutationFieldCodecV1;
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
		"trustedValues",
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
			column: string;
			codec: PostgresMutationFieldCodecV1;
			nullable: boolean;
			requiredInput: boolean;
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
	readonly candidateValidation?: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		result: readonly PostgresOperationResultV1[];
	}>;
	readonly candidatePolicy: Readonly<{
		freshAfterRowLockWait: true;
		mutableEvidenceCollections: readonly `collection:${string}`[];
		sql: string;
	}>;
	readonly candidatePolicyCheck?: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		outcome: "authorizedOrUnavailable";
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
		"compareAndSet",
		"sparseCallerFieldAuthority",
		"pureNormalization",
		"serverValues",
		"trustedValues",
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
	readonly candidateValidation: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		result: readonly PostgresOperationResultV1[];
		currentResult?: readonly PostgresOperationResultV1[];
	}>;
	readonly fieldAuthority: PostgresCreateOperationPlanV1["fieldAuthority"];
	readonly currentPolicy: PostgresCreateOperationPlanV1["candidatePolicy"];
	readonly candidatePolicy: PostgresCreateOperationPlanV1["candidatePolicy"];
	readonly candidatePolicyCheck?: NonNullable<
		PostgresCreateOperationPlanV1["candidatePolicyCheck"]
	>;
	readonly outputAuthority: PostgresCreateOperationPlanV1["outputAuthority"];
	readonly write: PostgresCreateOperationPlanV1["write"];
	readonly limits: Readonly<{ rows: number; durationMilliseconds: number }>;
}

/**
 * Delete addresses one row by key and writes no Field values, so it has no
 * candidate/normalizer/server-value/trusted-value lane. When the Collection
 * has an authored lifecycle program, `currentValidation` selects the full
 * locked current row (fresh, after the lock) so the runtime can interpret
 * only the `validate` phase against `{ candidate: null, current, now }` — no
 * `check`/`afterWrite` wiring in this slice (ADR-0047). The row-scope Policy
 * `current` check gates both `currentValidation` and the final
 * `DELETE ... RETURNING` write, evaluated fresh in each statement.
 */
export interface PostgresDeleteOperationPlanV1 {
	readonly identity: CollectionOperationProgramV1["identity"];
	readonly target: CollectionOperationProgramV1["target"];
	readonly member: "delete";
	readonly policy: CollectionOperationProgramV1["policy"];
	readonly outputCardinality: "optionalOne";
	readonly lifecycle: readonly [
		"keyedRowLock",
		"freshCurrentPolicy",
		"postgresConstraints",
		"selection",
		"outputFieldAuthority",
	];
	readonly lock: PostgresGetOperationPlanV1["lock"];
	readonly currentValidation?: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresOperationParameterV1[];
		result: readonly PostgresOperationResultV1[];
	}>;
	readonly currentPolicy: PostgresCreateOperationPlanV1["candidatePolicy"];
	readonly outputAuthority: PostgresCreateOperationPlanV1["outputAuthority"];
	readonly write: PostgresCreateOperationPlanV1["write"];
	readonly limits: Readonly<{ rows: number; durationMilliseconds: number }>;
}

export interface PostgresCollectionOperationPlansV1 {
	readonly format: "questpie.postgres-collection-operation-plans";
	readonly version: 1;
	readonly plans: readonly (
		| PostgresCreateOperationPlanV1
		| PostgresDeleteOperationPlanV1
		| PostgresGetOperationPlanV1
		| PostgresUpdateOperationPlanV1
	)[];
	readonly digest: string;
}
