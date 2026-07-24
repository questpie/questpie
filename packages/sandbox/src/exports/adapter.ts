// @questpie/sandbox/adapter — the production sandboxed ExecutorAdapter.
// Wire into the executor config as:
//   executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }

export {
	HttpSandboxAdapter,
	httpSandboxAdapter,
	type HttpSandboxAdapterOptions,
	type WorkloadHttpSandboxOptions,
} from "../adapter-http.js";
export type {
	SandboxWorkloadAuditContext,
	SandboxWorkloadAuditEvent,
	SandboxWorkloadAuthorizer,
	SandboxWorkloadPolicy,
	SandboxWorkloadRunOptions,
} from "../workload.js";
