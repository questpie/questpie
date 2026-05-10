import type { CodegenPlugin } from "questpie/codegen";

export function mcpPlugin(): CodegenPlugin {
	return {
		name: "questpie-mcp",
		targets: {
			server: {
				root: ".",
				outputFile: "index.ts",
				categories: {
					mcpTools: {
						dirs: ["mcp-tools"],
						prefix: "mcpTool",
						factoryFunctions: ["mcpTool"],
						registryKey: true,
						includeInAppState: true,
						extractFromModules: true,
						typeEmit: "standard",
					},
				},
				discover: {
					mcpConfig: { pattern: "config/mcp.ts", configKey: "mcp" },
				},
				registries: {
					singletonFactories: {
						mcpConfig: {
							configType: "McpConfig",
							imports: [
								{
									name: "McpConfig",
									from: "@questpie/mcp",
								},
							],
							isCallback: true,
						},
					},
				},
				scaffolds: {
					"mcp-tool": {
						dir: "mcp-tools",
						description: "MCP custom tool definition",
						template: ({ kebab, camel }) =>
							`import { mcpTool } from "@questpie/mcp";\nimport { z } from "zod";\n\nexport default mcpTool("${kebab}", {\n\tdescription: "Run ${kebab}.",\n\tinputSchema: z.object({}),\n}).handler(async ({ ctx }) => {\n\treturn {\n\t\tstructuredContent: { ok: true },\n\t\tcontent: [{ type: "text", text: "${camel} completed" }],\n\t};\n});\n`,
					},
				},
			},
		},
	};
}
