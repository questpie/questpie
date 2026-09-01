import type { QueryParameterV1, ScalarCodecV1 } from "../types";
import type { PostgresKeyedLookupProofV1 } from "./nondisclosure";
import type { PostgresQueryParameterV1 } from "./parameters";

export type PostgresQueryResultV1 =
	| Readonly<{
			kind: "field";
			key: string;
			field: string;
			column: string;
			codec: ScalarCodecV1;
			nullable: boolean;
			guardColumn?: string;
	  }>
	| Readonly<{
			kind: "toOne";
			key: string;
			relation: string;
			collection: string;
			presenceColumn: string;
			fields: readonly Readonly<{
				key: string;
				field: string;
				column: string;
				codec: ScalarCodecV1;
				nullable: boolean;
				guardColumn?: string;
			}>[];
			relations?: readonly Extract<PostgresQueryResultV1, { kind: "toOne" }>[];
	  }>;

type PostgresQueryFieldResult = Extract<
	PostgresQueryResultV1,
	{ kind: "field" }
>;

export type PostgresInverseListResultV2 = Readonly<{
	kind: "inverseList";
	key: string;
	relation: string;
	source: string;
	correlation: readonly Readonly<{ field: string; reference: string }>[];
	first: number;
	ordinalColumn: string;
	fields: readonly Omit<PostgresQueryFieldResult, "kind">[];
	relations: readonly Extract<PostgresQueryResultV1, { kind: "toOne" }>[];
}>;

export interface PostgresQueryPlanV1 {
	readonly format: "questpie.postgres-query-plan";
	readonly version: 1;
	readonly queryDigest: string;
	readonly templateDigest: string;
	readonly policy: string;
	readonly policyProgramDigest: string;
	readonly disclosureProgramDigest: string;
	readonly usedExecutionFacts: readonly (
		| "authorityKind"
		| "principalKind"
		| "principalId"
		| "tenantId"
	)[];
	readonly admission: "authenticated" | "public" | "system";
	readonly binding: Readonly<{
		parameters: readonly QueryParameterV1[];
	}>;
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
	readonly nondisclosure: Readonly<{
		keyedLookup: PostgresKeyedLookupProofV1;
	}>;
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

export interface PostgresQueryPlansV1 {
	readonly format: "questpie.postgres-query-plans";
	readonly version: 1;
	readonly plans: readonly PostgresQueryPlanV1[];
}

export interface PostgresQueryPlansV2 {
	readonly format: "questpie.postgres-query-plans";
	readonly version: 2;
	readonly plans: readonly (
		| (PostgresQueryPlanV1 & Readonly<{ templateVersion: 1 }>)
		| PostgresQueryPlanV2
	)[];
}
