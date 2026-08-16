import { digest } from "../canonical";
import type { DataQueryTemplateV1, PolicyProgramV1 } from "./types";

export { relationalDiscoverySource } from "./discovery";
export { projectRelationalGeneratedContract } from "./generated-contract";
export type {
	RelationalGeneratedContractV1,
	RelationalGeneratedSelectionV1,
} from "./generated-contract";
export { normalizeBoundPolicy } from "./binding";
export type { BoundPolicyProgramV1, PolicyScopeBindingV1 } from "./binding";
export { projectRelationalCompilation } from "./projection";
export { projectRelationalNondisclosure } from "./nondisclosure";
export type {
	RelationalNondisclosureQueryV1,
	RelationalNondisclosureV1,
} from "./nondisclosure";
export { lowerPostgresQueryPlans } from "./postgres";
export type { PostgresQueryPlanV1, PostgresQueryPlansV1 } from "./postgres";
export {
	lowerPostgresMutationPolicyCheck,
	postgresMutationCollection,
} from "./postgres-mutation-seam";
export type {
	PostgresMutationCollectionV1,
	PostgresMutationFieldV1,
} from "./postgres-mutation-seam";

export {
	normalizePolicyPrograms,
	selectDefaultPolicy,
} from "./normalize-policy";
export { normalizeDataQueryTemplate } from "./normalize-query";
export type {
	DataQueryTemplateV1,
	PolicyExpressionV1,
	PolicyProgramV1,
	RootQueryFilterV1,
	ScalarCodecV1,
} from "./types";

export function policyProgramDigest(program: PolicyProgramV1): string {
	return digest("questpie-policy-program-v1", program);
}

export function dataQueryTemplateDigest(template: DataQueryTemplateV1): string {
	return digest("questpie-data-query-template-v1", template);
}
