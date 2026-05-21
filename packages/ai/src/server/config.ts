export interface RunInjection {
	systemPrompt?: string;
	context?: string;
	mcpServers?: {
		name: string;
		url?: string;
		command?: string;
		args?: string[];
		env?: Record<string, string>;
	}[];
}

export interface AiModuleConfig {
	defaultRuntime?: string;
	onBeforeRun?(
		run: { id: string; prompt: string; runtime?: string | null },
		ctx: any,
	): Promise<RunInjection>;
	onAfterComplete?(
		run: { id: string },
		result: {
			text?: string;
			sessionRef?: string;
			inputTokens?: number;
			outputTokens?: number;
		},
		ctx: any,
	): Promise<void>;
}

export function aiConfig<T extends AiModuleConfig>(config: T): T {
	return config;
}
