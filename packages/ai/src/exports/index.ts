export { aiConfig } from "../server/config.js";
export type { AiModuleConfig, RunInjection } from "../server/config.js";

export { aiPlugin } from "../server/plugin.js";

export type {
	AiLeaseStatus,
	AiRunEventLevel,
	AiRunStatus,
	AiWorkerStatus,
	ClaimRunInput,
	ClaimedRun,
	CompleteRunInput,
	ReportRunEventInput,
	SpawnAgentRunner,
	SpawnAgentRunHandle,
	SpawnAgentRunRequest,
	SpawnedRun,
	SpawnRunInput,
	WorkerRuntime,
} from "../server/modules/ai/services/worker-manager.js";

export type {
	ModelMessage,
	UIMessage,
	TextPart,
	ToolCallPart,
	ToolResultPart,
	AssistantModelMessage,
	UserModelMessage,
	ToolModelMessage,
	SystemModelMessage,
} from "ai";
