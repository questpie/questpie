import type { RuntimeKind, ResolvedProvider } from "./modules/ai/services/provider-runtime.js";

export interface RunInjection {
  systemPrompt?: string;
  context?: string;
  mcpServers?: { name: string; url?: string; command?: string; args?: string[]; env?: Record<string, string> }[];
  modelOverride?: string;
}

export interface AiModuleConfig {
  defaultRuntime?: RuntimeKind;
  defaultModel?: string;
  onBeforeRun?(run: { id: string; sessionId?: string; prompt: string; runtime: RuntimeKind }, ctx: any): Promise<RunInjection>;
  onAfterComplete?(run: { id: string; sessionId?: string }, result: { text: string; sessionRef: string; inputTokens: number; outputTokens: number }, ctx: any): Promise<void>;
  onSessionCreated?(session: { id: string; title?: string }, ctx: any): Promise<void>;
  resolveProvider?(request: { model?: string | null; provider?: string | null; runtime?: RuntimeKind | null }, ctx: any): Promise<ResolvedProvider | null>;
}

export function aiConfig<T extends AiModuleConfig>(config: T): T {
  return config;
}
