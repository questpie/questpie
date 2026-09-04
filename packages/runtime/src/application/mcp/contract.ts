export const MCP_PROTOCOL_VERSION = "2026-07-28" as const;

export type McpToolBinding = Readonly<{
	identity: string;
	kind: "query" | "mutation" | "action";
	tool: Readonly<Record<string, unknown>>;
}>;

export type McpExecutionResult = Readonly<{
	structuredContent: unknown;
	isError: boolean;
}>;
