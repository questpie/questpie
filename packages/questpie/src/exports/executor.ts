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
export { SandboxBroker } from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
export type {
	BindingTarget,
	MintedToken,
	MintTokenOptions,
	SandboxBrokerDiagnosticEvent,
	SandboxBrokerOptions,
} from "#questpie/server/modules/core/integrated/executor/bindings/broker.js";
export {
	BINDINGS_TOKEN_HEADER,
	BROKER_HTTP_RESULT_CAP_BYTES,
	BROKER_NATIVE_RESULT_CAP_BYTES,
	FRAME_MARKER,
	HTTP_FETCH_BODY_CAP_BYTES,
	parseBindingMethod,
	snapshotBoundedBrokerValue,
} from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
export type {
	BindingError,
	BindingErrorCode,
	BindingMethod,
	BoundedBrokerValue,
	BrokerJsonValue,
	BrokerRpcRequest,
	BrokerRpcResponse,
	GuestMessage,
	GuestResultMessage,
	GuestRpcMessage,
	HostRpcResultMessage,
	HttpFetchRequest,
	HttpFetchResponse,
	ParsedBindingMethod,
} from "#questpie/server/modules/core/integrated/executor/bindings/protocol.js";
export { hostFetch } from "#questpie/server/modules/core/integrated/executor/bindings/host-fetch.js";
export type {
	DnsResolver,
	HostFetchOptions,
	HostFetchResult,
} from "#questpie/server/modules/core/integrated/executor/bindings/host-fetch.js";
export {
	classifyIpLiteral,
	parseHostEntry,
} from "#questpie/server/modules/core/integrated/executor/bindings/net-validation.js";
export type {
	IpValidationResult,
	ParsedHost,
} from "#questpie/server/modules/core/integrated/executor/bindings/net-validation.js";
