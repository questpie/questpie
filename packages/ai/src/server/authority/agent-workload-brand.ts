import { AgentWorkloadAuthorityError } from "./agent-workload-error.js";
import type {
	AgentWorkloadPrincipal,
	AgentWorkloadPrincipalClaims,
} from "./agent-workload-types.js";

const trustedPrincipals = new WeakSet<object>();

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
}

export function markTrustedAgentWorkloadPrincipal(
	principal: AgentWorkloadPrincipalClaims,
): void {
	Object.defineProperty(principal, "toJSON", {
		configurable: false,
		enumerable: false,
		value: () => {
			throw new AgentWorkloadAuthorityError("internal_transport_required");
		},
		writable: false,
	});
	trustedPrincipals.add(principal);
}

export function freezeTrustedAgentWorkloadPrincipal(
	principal: AgentWorkloadPrincipalClaims,
): AgentWorkloadPrincipal {
	markTrustedAgentWorkloadPrincipal(principal);
	return deepFreeze(principal) as AgentWorkloadPrincipal;
}

export function isTrustedAgentWorkloadPrincipal(
	principal: unknown,
): principal is AgentWorkloadPrincipal {
	return (
		typeof principal === "object" &&
		principal !== null &&
		trustedPrincipals.has(principal)
	);
}
