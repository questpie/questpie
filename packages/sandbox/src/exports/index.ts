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
	SandboxCapabilities,
	SandboxRunRequest,
	SandboxRunResult,
} from "../types.js";
