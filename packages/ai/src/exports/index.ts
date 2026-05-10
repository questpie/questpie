export { aiConfig } from "../server/config.js";
export type { AiModuleConfig, RunInjection } from "../server/config.js";

export { aiPlugin } from "../server/plugin.js";

export type {
  ResolveProviderInput,
  ResolvedProvider,
  RuntimeKind,
} from "../server/modules/ai/services/provider-runtime.js";

export type {
  ClaimRunInput,
  ClaimedRun,
  WorkerCapability,
} from "../server/modules/ai/services/worker-manager.js";

export type {
  CreateAssistantMessageInput,
  SendMessageInput,
  SendMessageResult,
} from "../server/modules/ai/services/chat.js";

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
