import { digest } from "../canonical";
import type { DataQueryTemplateV1, PolicyProgramV1 } from "./types";

export {
	normalizePolicyPrograms,
	selectDefaultPolicy,
} from "./normalize-policy";
export { normalizeDataQueryTemplate } from "./normalize-query";
export type {
	DataQueryTemplateV1,
	PolicyProgramV1,
	RootQueryFilterV1,
} from "./types";

export function policyProgramDigest(program: PolicyProgramV1): string {
	return digest("questpie-policy-program-v1", program);
}

export function dataQueryTemplateDigest(template: DataQueryTemplateV1): string {
	return digest("questpie-data-query-template-v1", template);
}
