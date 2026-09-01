import type { ScalarCodecV1 } from "./scalar";

export type ScalarValue = boolean | number | string;

export type QueryParameterV1 =
	| Readonly<{
			name: string;
			kind: "scalar";
			codec: ScalarCodecV1;
			nullable: boolean;
	  }>
	| Readonly<{
			name: string;
			kind: "list";
			codec: ScalarCodecV1;
			maximumItems: number;
			nullable: boolean;
			semantics: "set";
	  }>
	| Readonly<{ name: string; kind: "cursor"; nullable: true }>;

export type PostgresQueryParameterV1 =
	| Readonly<{
			position: number;
			kind: "cursorPresent";
			parameter: string;
			postgresType: "boolean";
	  }>
	| Readonly<{
			position: number;
			kind: "cursorValue";
			parameter: string;
			field: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "executionFact";
			source: string;
			path: readonly string[];
			codec: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "literal";
			value: null | ScalarValue;
			codec: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "queryParameter";
			parameter: string;
			postgresType: string;
	  }>;

export type ResultFieldV1 = Readonly<{
	key: string;
	field: string;
	column: string;
	codec: ScalarCodecV1;
	nullable: boolean;
	guardColumn?: string;
}>;

export type PostgresQueryResultV1 =
	| (ResultFieldV1 & Readonly<{ kind: "field"; guardColumn?: string }>)
	| Readonly<{
			kind: "toOne";
			key: string;
			relation: string;
			collection?: string;
			presenceColumn: string;
			fields: readonly ResultFieldV1[];
			relations?: readonly Extract<PostgresQueryResultV1, { kind: "toOne" }>[];
	  }>;

export type PostgresInverseListResultV2 = Readonly<{
	kind: "inverseList";
	key: string;
	relation: string;
	source: string;
	correlation: readonly Readonly<{ field: string; reference: string }>[];
	first: number;
	ordinalColumn: string;
	fields: readonly ResultFieldV1[];
	relations: readonly Extract<PostgresQueryResultV1, { kind: "toOne" }>[];
}>;

export interface PostgresQueryPlanV1 {
	readonly format: "questpie.postgres-query-plan";
	readonly version: 1;
	readonly queryDigest: string;
	readonly templateDigest: string;
	readonly policy: string;
	readonly policyProgramDigest: string;
	readonly disclosureProgramDigest?: string;
	readonly usedExecutionFacts: readonly (
		| "authorityKind"
		| "principalKind"
		| "principalId"
		| "tenantId"
	)[];
	readonly admission: "authenticated" | "public" | "system";
	readonly binding: Readonly<{ parameters: readonly QueryParameterV1[] }>;
	readonly page: Readonly<{
		kind: "forwardCursor";
		first: Readonly<{ parameter: string; minimum: number; maximum: number }>;
		after: Readonly<{ parameter: string }>;
		scopeParameters: readonly string[];
		order: readonly Readonly<{
			field: string;
			codec: string;
			nullable: boolean;
			withTimezone?: boolean;
		}>[];
	}>;
	readonly sql: string;
	readonly parameters: readonly PostgresQueryParameterV1[];
	readonly result: readonly PostgresQueryResultV1[];
}

export type PostgresQueryPlanV2 = Omit<
	PostgresQueryPlanV1,
	"version" | "result"
> &
	Readonly<{
		version: 2;
		templateVersion: 2;
		inversePolicyProgramDigest: string;
		ordinalColumns: readonly ["qp_root_ordinal", string];
		result: readonly (PostgresQueryResultV1 | PostgresInverseListResultV2)[];
		statementDigest: string;
	}>;

export type PostgresQueryPlan = PostgresQueryPlanV1 | PostgresQueryPlanV2;
