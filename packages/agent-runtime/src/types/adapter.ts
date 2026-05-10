import type { RuntimeKind, RuntimeConfig } from "./runtime.js";
import type { RuntimeEvent } from "./events.js";
import type { SessionEntry, SessionSnapshot } from "./sessions.js";
import type { RuntimeProfile, McpServerConfig } from "./profiles.js";

export interface RuntimeDetectionInput {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
}

export interface RuntimeDetectionResult {
	readonly available: boolean;
	readonly version?: string;
	readonly binaryPath?: string;
	readonly supportsSessions: boolean;
	readonly supportsMcp: boolean;
	readonly supportsSkills: boolean;
}

export interface RuntimeAdapterContext {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
}

export interface RuntimeStorageInfo {
	readonly homePath: string;
	readonly configPath?: string;
	readonly sessionPath?: string;
}

export interface RuntimeListSessionsInput {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
	readonly cwd?: string;
}

export interface RuntimeGetSessionInput {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
	readonly sessionRef: string;
}

export interface RuntimeSendMessageInput {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
	readonly commandId: string;
	readonly prompt: string;
	readonly cwd?: string;
	readonly sessionRef?: string;
	readonly profile?: RuntimeProfile;
	readonly modelPreference?: string;
	readonly systemPrompt?: string;
	readonly mcpServers?: readonly McpServerConfig[];
	readonly signal?: AbortSignal;
}

export interface RuntimeConfigureInput {
	readonly workerDir: string;
	readonly config: RuntimeConfig;
	readonly profile: RuntimeProfile;
}

export interface RuntimeConfigureResult {
	readonly applied: boolean;
	readonly warnings?: string[];
}

export interface RuntimeCancelInput {
	readonly commandId: string;
}

export interface RuntimeAdapter {
	readonly kind: RuntimeKind;
	detect(input: RuntimeDetectionInput): Promise<RuntimeDetectionResult>;
	getStorageInfo(input: RuntimeAdapterContext): Promise<RuntimeStorageInfo>;
	listSessions(input: RuntimeListSessionsInput): Promise<SessionEntry[]>;
	getSession(input: RuntimeGetSessionInput): Promise<SessionSnapshot>;
	sendMessage(
		input: RuntimeSendMessageInput,
	): AsyncIterable<RuntimeEvent>;
	configure?(input: RuntimeConfigureInput): Promise<RuntimeConfigureResult>;
	cancel?(input: RuntimeCancelInput): Promise<void>;
}
