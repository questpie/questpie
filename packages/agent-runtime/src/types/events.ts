import type { RuntimeKind } from "./runtime.js";
import type { AgentRuntimeError } from "./errors.js";

export type RuntimeEvent =
	| RuntimeEventCommandStarted
	| RuntimeEventSessionResolved
	| RuntimeEventTextDelta
	| RuntimeEventThinkingDelta
	| RuntimeEventToolStarted
	| RuntimeEventToolUpdate
	| RuntimeEventToolCompleted
	| RuntimeEventUsage
	| RuntimeEventCommandCompleted
	| RuntimeEventCommandFailed
	| RuntimeEventCommandCancelled;

export interface RuntimeEventCommandStarted {
	readonly type: "command.started";
	readonly commandId: string;
	readonly runtime: RuntimeKind;
}

export interface RuntimeEventSessionResolved {
	readonly type: "session.resolved";
	readonly commandId: string;
	readonly sessionRef: string;
	readonly isNew: boolean;
}

export interface RuntimeEventTextDelta {
	readonly type: "text.delta";
	readonly commandId: string;
	readonly text: string;
}

export interface RuntimeEventThinkingDelta {
	readonly type: "thinking.delta";
	readonly commandId: string;
	readonly text: string;
}

export interface RuntimeEventToolStarted {
	readonly type: "tool.started";
	readonly commandId: string;
	readonly tool: string;
	readonly input?: unknown;
}

export interface RuntimeEventToolUpdate {
	readonly type: "tool.update";
	readonly commandId: string;
	readonly tool: string;
	readonly status?: string;
	readonly output?: unknown;
}

export interface RuntimeEventToolCompleted {
	readonly type: "tool.completed";
	readonly commandId: string;
	readonly tool: string;
	readonly output?: unknown;
}

export interface RuntimeEventUsage {
	readonly type: "usage";
	readonly commandId: string;
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cost?: number;
}

export interface RuntimeEventCommandCompleted {
	readonly type: "command.completed";
	readonly commandId: string;
	readonly result: import("./commands.js").CommandResult;
}

export interface RuntimeEventCommandFailed {
	readonly type: "command.failed";
	readonly commandId: string;
	readonly error: AgentRuntimeError;
}

export interface RuntimeEventCommandCancelled {
	readonly type: "command.cancelled";
	readonly commandId: string;
}
