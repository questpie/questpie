export { aiConfig } from "../server/config.js";
export type { AiModuleConfig, RunInjection } from "../server/config.js";

export { aiPlugin } from "../server/plugin.js";

export type {
	AgentRuntimeRunRequest,
	AiLeaseStatus,
	AiRunStatus,
	AiWorkerStatus,
	ClaimRunInput,
	ClaimedRun,
	WorkerRuntime,
} from "../server/modules/ai/services/worker-manager.js";

export {
	ANTHROPIC_API_VERSION,
	ANTHROPIC_PHASE_0_MODEL_ID,
	createAnthropicCommercialAdapter,
} from "../server/providers/anthropic-commercial.js";
export type {
	AnthropicCommercialAdapter,
	AnthropicCommercialAdapterOptions,
	AnthropicFetch,
	AnthropicModelOffering,
	AnthropicVerificationEvidence,
	AnthropicVerificationResult,
} from "../server/providers/anthropic-commercial.js";

export { AgentWorkloadAuthorityError } from "../server/authority/agent-workload-error.js";
export type { AgentWorkloadAuthorityErrorCode } from "../server/authority/agent-workload-error.js";
export { createAgentWorkloadPrincipalResolver } from "../server/authority/agent-workload-resolver.js";
export type {
	AgentWorkloadPrincipalResolver,
	AgentWorkloadPrincipalResolverOptions,
} from "../server/authority/agent-workload-resolver.js";
export type {
	AgentWorkloadAudience,
	AgentWorkloadAuthorityRecord,
	AgentWorkloadAuthoritySnapshot,
	AgentWorkloadAuthorityStore,
	AgentWorkloadGrantRequirement,
	AgentWorkloadPrincipal,
	AgentWorkloadRunStatus,
	AuthenticatedAgentWorkloadEnvelope,
	ResolveAgentWorkloadPrincipalInput,
} from "../server/authority/agent-workload-types.js";
export { allowsExactScopedGrant } from "../server/authority/exact-scope-grants.js";
export type { ExactScopedGrantAuthority } from "../server/authority/exact-scope-grants.js";
export { createAuthenticatedAgentWorkloadTransport } from "../server/authority/agent-workload-transport.js";
export type {
	AuthenticatedAgentWorkloadTransport,
	AuthenticatedAgentWorkloadTransportOptions,
} from "../server/authority/agent-workload-transport.js";
