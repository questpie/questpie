import type {
	PostgresParameter,
	PostgresStatement,
} from "../postgres/contract";
import type { ScalarCodecV1 } from "../relational/scalar";
import type {
	FieldNormalizerProgramV1,
	LinkedCollectionOperationProgramV1,
	ServerValueProgramV1,
} from "./program";

export type RecordValue = Readonly<Record<string, unknown>>;
export type FieldPath = readonly string[];
export type PostgresCollectionRows = readonly Readonly<
	Record<string, unknown>
>[];
export type PostgresCollectionStatement = PostgresStatement<
	readonly PostgresParameter[],
	PostgresCollectionRows
>;

export type PostgresParameterV1 =
	| Readonly<{
			position: number;
			postgresType: string;
			kind: "callerInput" | "key";
			path: FieldPath;
			codec: ScalarCodecV1;
	  }>
	| Readonly<{
			position: number;
			postgresType: string;
			kind: "executionFact";
			path: FieldPath;
			codec: ScalarCodecV1["kind"];
			source: string;
	  }>
	| Readonly<{
			position: number;
			postgresType: string;
			kind: "literal";
			codec: ScalarCodecV1["kind"];
			value: null | boolean | number | string;
	  }>;

export type PostgresResultV1 = Readonly<{
	path: FieldPath;
	column: string;
	codec: ScalarCodecV1;
	nullable: boolean;
	guardColumn?: string;
}>;

export type OutputAuthorityV1 = Readonly<{
	freshAfterRowLockWait: true;
	selectedPaths: readonly Readonly<{
		path: FieldPath;
		conditional: boolean;
		guardColumn?: string;
		mutableEvidenceCollections: readonly string[];
	}>[];
}>;

export type LinkedPostgresGetOperationPlanV1 = Readonly<{
	identity: string;
	target: string;
	member: "get";
	policy: string;
	outputCardinality: "optionalOne";
	consistency: Readonly<{
		standalone: "readSnapshot";
		nestedMutation: "keyedLockThenFreshPolicyRead";
	}>;
	lifecycle: readonly [
		"keyedRowLock",
		"freshPolicyRead",
		"selection",
		"outputFieldAuthority",
	];
	lock: Readonly<{
		sql: string;
		parameters: readonly PostgresParameterV1[];
		outcome: "internalLockedOrAbsent";
		statement: PostgresCollectionStatement;
	}>;
	read: Readonly<{
		freshAfterRowLockWait: true;
		sql: string;
		parameters: readonly PostgresParameterV1[];
		result: readonly PostgresResultV1[];
		statement: PostgresCollectionStatement;
	}>;
	outputAuthority: OutputAuthorityV1;
	limits: Readonly<{ rows: 1; durationMilliseconds: 5_000 }>;
	operation: LinkedCollectionOperationProgramV1;
}>;

export type LinkedPostgresCreateOperationPlanV1 = Readonly<{
	identity: string;
	target: string;
	member: "create";
	policy: string;
	outputCardinality: "one";
	lifecycle: readonly [
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
	normalizerProgram: FieldNormalizerProgramV1 | null;
	serverValueProgram: ServerValueProgramV1 | null;
	candidate: Readonly<{
		steps: readonly RecordValue[];
		fields: readonly Readonly<{
			path: FieldPath;
			codec: ScalarCodecV1;
			nullable: boolean;
		}>[];
	}>;
	fieldAuthority: Readonly<{
		suppliedPathsOnly: true;
		checks: readonly Readonly<{
			path: FieldPath;
			sql: string;
			parameters: readonly PostgresParameterV1[];
			statement: PostgresCollectionStatement;
		}>[];
	}>;
	candidatePolicy: Readonly<{
		freshAfterRowLockWait: true;
		mutableEvidenceCollections: readonly string[];
		sql: string;
	}>;
	outputAuthority: OutputAuthorityV1;
	write: Readonly<{
		sql: string;
		parameters: readonly PostgresParameterV1[];
		result: readonly PostgresResultV1[];
		statement: PostgresCollectionStatement;
	}>;
	limits: Readonly<{ rows: 100; durationMilliseconds: 5_000 }>;
	operation: LinkedCollectionOperationProgramV1;
}>;

export type LinkedPostgresCollectionOperationPlanV1 =
	| LinkedPostgresCreateOperationPlanV1
	| LinkedPostgresGetOperationPlanV1;

export type LinkedPostgresCollectionOperationPlansV1 = Readonly<{
	plans: readonly LinkedPostgresCollectionOperationPlanV1[];
	byIdentity: ReadonlyMap<string, LinkedPostgresCollectionOperationPlanV1>;
}>;
