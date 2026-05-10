import type { z } from "zod";

import type {
	McpToolConfig,
	McpToolDefinition,
	McpToolHandlerArgs,
} from "./types.js";

class McpToolBuilder<
	TInputSchema extends z.ZodTypeAny,
	TOutputSchema extends z.ZodTypeAny,
> {
	constructor(
		private readonly name: string,
		private readonly config: McpToolConfig<TInputSchema, TOutputSchema>,
	) {}

	handler(
		handler: (
			args: McpToolHandlerArgs<z.infer<TInputSchema>>,
		) => ReturnType<McpToolDefinition<TInputSchema, TOutputSchema>["handler"]>,
	): McpToolDefinition<TInputSchema, TOutputSchema> {
		return Object.freeze({
			__brand: "mcpTool" as const,
			name: this.name,
			config: this.config,
			handler,
		});
	}
}

export function mcpTool<
	TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
	TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
>(
	name: string,
	config: McpToolConfig<TInputSchema, TOutputSchema> = {},
): McpToolBuilder<TInputSchema, TOutputSchema> {
	return new McpToolBuilder(name, config);
}

export function isMcpTool(value: unknown): value is McpToolDefinition {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { __brand?: unknown }).__brand === "mcpTool" &&
		typeof (value as { handler?: unknown }).handler === "function"
	);
}
