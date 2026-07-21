// @questpie/sandbox — hardened sandboxed code execution for the QUESTPIE
// `executor` primitive.
//
// The actual execution engine is the standalone Deno service `sandbox-server.ts`
// (shipped as source; runs under Deno only). The main app (Bun/Node) imports the
// HTTP adapter below and never touches Deno.

export {
	HttpSandboxAdapter,
	httpSandboxAdapter,
	type AgentWorkloadHttpRunOptions,
	type AgentWorkloadHttpSandboxOptions,
	type AgentWorkloadInputProjectionReference,
	type AgentWorkloadInputProjectionRegistry,
	type AgentWorkloadInputProjector,
	type HttpSandboxAdapterOptions,
} from "../adapter-http.js";

export {
	classifyIpLiteral,
	parseHostEntry,
	validateEgressHosts,
	validateHostEgress,
	type DnsResolver,
	type IpValidationResult,
	type ParsedHost,
} from "../net-validation.js";

export type {
	GuestMessage,
	GuestResultMessage,
	GuestRpcMessage,
	HostRpcResultMessage,
	SandboxBindings,
	SandboxBindingError,
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "../types.js";
export {
	AGENT_WORKLOAD_ADMISSION_HEADER,
	BINDINGS_TOKEN_HEADER,
	FRAME_MARKER,
	NON_AGENT_ADMISSION_HEADER,
} from "../types.js";

export {
	buildGuestBindings,
	type GuestBindings,
	type GuestCollection,
	type HostCall,
} from "../guest-bindings.js";

export {
	createAgentWorkloadSandboxBoundary,
	type AgentWorkloadSandboxBoundary,
	type AgentWorkloadSandboxContext,
	type AgentWorkloadSandboxGuestContext,
	type AgentWorkloadSandboxHostContext,
	type AgentWorkloadSandboxBoundaryOptions,
	type AgentWorkloadSandboxSession,
} from "../agent-workload-boundary.js";
export type { AgentWorkloadSandboxAuditEvent } from "../agent-workload-audit.js";
export type { AgentWorkloadSandboxPolicy } from "../agent-workload-policy.js";
export {
	AGENT_WORKLOAD_SANDBOX_DENIAL_MESSAGE,
	AgentWorkloadSandboxDeniedError,
} from "../agent-workload-denial.js";
export {
	allowsAgentWorkloadSandboxCapability,
	type AgentWorkloadSandboxCapabilityRequest,
} from "../agent-workload-capabilities.js";
