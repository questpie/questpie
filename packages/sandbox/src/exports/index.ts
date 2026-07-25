// @questpie/sandbox — hardened sandboxed code execution for the QUESTPIE
// `executor` primitive.
//
// The actual execution engine is the standalone Deno service `sandbox-server.ts`
// (shipped as source; runs under Deno only). The main app (Bun/Node) imports the
// HTTP adapter below and never touches Deno.

export {
	HttpSandboxAdapter,
	httpSandboxAdapter,
	type HttpSandboxAdapterOptions,
	type WorkloadHttpSandboxOptions,
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
	BINDINGS_TOKEN_HEADER,
	FRAME_MARKER,
	HOST_ADMISSION_HEADER,
	WORKLOAD_ADMISSION_HEADER,
} from "../types.js";

export {
	buildGuestBindings,
	type GuestBindings,
	type GuestCollection,
	type GuestToolDescriptor,
	type GuestToolResult,
	type GuestTools,
	type HostCall,
} from "../guest-bindings.js";

export {
	sandboxCustomTools,
	type SandboxCustomToolEvidenceContext,
	type SandboxCustomToolEvidenceEvent,
	type SandboxCustomToolsConfig,
	type SandboxCustomToolsLimits,
	type SandboxCustomToolsRunOptions,
} from "../custom-tools.js";

export {
	SANDBOX_WORKLOAD_DENIAL_MESSAGE,
	SandboxWorkloadDeniedError,
	type SandboxWorkloadAuditContext,
	type SandboxWorkloadAuditEvent,
	type SandboxWorkloadAuthorizationContext,
	type SandboxWorkloadAuthorizationPhase,
	type SandboxWorkloadAuthorizer,
	type SandboxWorkloadPolicy,
	type SandboxWorkloadRunOptions,
} from "../workload.js";
export type {
	SandboxWorkloadAdmissionClaims,
	SandboxWorkloadAdmissionDenialReason,
	SandboxWorkloadAdmissionKey,
	SandboxWorkloadAdmissionVerification,
} from "../workload-admission.js";
