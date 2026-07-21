// @questpie/sandbox/adapter — the production sandboxed ExecutorAdapter.
// Wire into the executor config as:
//   executor: { sandboxed: httpSandboxAdapter({ url: process.env.SANDBOX_URL }) }

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
