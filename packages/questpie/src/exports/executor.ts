export type {
	ExecutorAdapter,
	ExecutorCapabilities,
	ExecutorIsolation,
	ExecutorRunOptions,
	ExecutorRunResult,
} from "#questpie/server/modules/core/integrated/executor/adapter.js";
export { InProcessExecutorAdapter } from "#questpie/server/modules/core/integrated/executor/adapters/in-process.js";
export { ExecutorService } from "#questpie/server/modules/core/integrated/executor/service.js";
export type { ExecutorConfig } from "#questpie/server/modules/core/integrated/executor/types.js";

// ── Untrusted-path bindings broker (capability-scoped app primitives) ──
export {
	checkBindingCapability,
	DOCUMENT_STORE_COLLECTION,
	knowledgePathMatches,
	normalizeKnowledgePath,
} from "#questpie/server/modules/core/integrated/executor/bindings/capability-check.js";
export type { CapabilityDecision } from "#questpie/server/modules/core/integrated/executor/bindings/capability-check.js";
export {
	SandboxBroker,
} from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
export type {
	BindingTarget,
	MintedToken,
	MintTokenOptions,
} from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
export {
	BINDINGS_TOKEN_HEADER,
	FRAME_MARKER,
	parseBindingMethod,
} from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
export type {
	BindingError,
	BindingErrorCode,
	BindingMethod,
	BrokerRpcRequest,
	BrokerRpcResponse,
	GuestMessage,
	GuestResultMessage,
	GuestRpcMessage,
	HostRpcResultMessage,
	ParsedBindingMethod,
} from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
