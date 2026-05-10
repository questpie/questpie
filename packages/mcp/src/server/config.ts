import type { McpConfig } from "./types.js";

export function mcpConfig<TConfig extends McpConfig>(config: TConfig): TConfig {
	return config;
}
