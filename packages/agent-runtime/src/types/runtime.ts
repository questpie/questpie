export type RuntimeKind =
	| "claude-code"
	| "codex"
	| "opencode"
	| "gemini"
	| "copilot"
	| "cursor";

export interface RuntimeConfig {
	readonly runtime: RuntimeKind;
	readonly binaryPath?: string;
	readonly models?: string[];
	readonly tags?: string[];
	readonly modelMap?: Record<string, string>;
}
