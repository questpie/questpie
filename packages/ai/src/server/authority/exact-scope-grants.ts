import type { AgentWorkloadGrantRequirement } from "./agent-workload-types.js";

export interface ExactScopedGrantAuthority {
	readonly scope: {
		readonly companyId: string;
		readonly anchorSpaceId: string;
	};
	readonly grants: {
		readonly company: readonly string[];
		readonly anchorSpace: readonly string[];
	};
}

/**
 * Shared Human/Agent domain decision seam. Actor kind is intentionally absent:
 * equal exact-scope role projections always produce equal decisions.
 */
export function allowsExactScopedGrant(
	authority: ExactScopedGrantAuthority,
	requirement: AgentWorkloadGrantRequirement,
): boolean {
	if (requirement.companyId !== authority.scope.companyId) {
		return false;
	}
	if (requirement.scope === "company") {
		return authority.grants.company.includes(requirement.grant);
	}
	return (
		requirement.anchorSpaceId === authority.scope.anchorSpaceId &&
		authority.grants.anchorSpace.includes(requirement.grant)
	);
}
