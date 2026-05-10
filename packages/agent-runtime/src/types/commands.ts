import type { RuntimeKind } from "./runtime.js";
import type { McpServerConfig, RuntimeProfileRef } from "./profiles.js";

export type RuntimeCommand =
	| RuntimeCommandMessageSend
	| RuntimeCommandSessionList
	| RuntimeCommandSessionGet;

export interface RuntimeCommandMessageSend {
	readonly type: "message.send";
	readonly runtime: RuntimeKind;
	readonly prompt: string;
	readonly cwd?: string;
	readonly sessionRef?: string;
	readonly profile?: RuntimeProfileRef;
	readonly modelPreference?: string;
	readonly systemPrompt?: string;
	readonly mcpServers?: readonly McpServerConfig[];
	readonly priority?: number;
	readonly meta?: Record<string, unknown>;
	readonly idempotencyKey?: string;
}

export interface RuntimeCommandSessionList {
	readonly type: "session.list";
	readonly runtime?: RuntimeKind;
}

export interface RuntimeCommandSessionGet {
	readonly type: "session.get";
	readonly runtime: RuntimeKind;
	readonly sessionRef: string;
}

export interface CommandHandle {
	readonly commandId: string;
	readonly events: AsyncIterable<import("./events.js").RuntimeEvent>;
	readonly completion: Promise<CommandResult>;
	cancel(): Promise<void>;
}

export interface CommandResult {
	readonly text: string;
	readonly thinking?: string;
	readonly sessionRef: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cost?: number;
	readonly stopReason: string;
}
