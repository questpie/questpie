export interface RuntimeProfile {
	readonly id: string;
	readonly name?: string;
	readonly mcpServers?: readonly McpServerConfig[];
	readonly skills?: readonly RuntimeSkillConfig[];
	readonly env?: Readonly<Record<string, string>>;
}

export interface McpServerConfig {
	readonly name: string;
	readonly url?: string;
	readonly command?: string;
	readonly args?: readonly string[];
	readonly env?: Readonly<Record<string, string>>;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface RuntimeSkillConfig {
	readonly name: string;
	readonly content: string;
}

export type RuntimeProfileRef = string | { id: string };
