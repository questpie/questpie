import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";
import type { z } from "zod";

export type McpTransportKind = "http" | "stdio";

export type McpAccessMode = "user" | "system";

export interface McpAccessRuleContext {
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	session?: RequestContext["session"];
	ctx: AppContext & Partial<RequestContext>;
}

export type McpAccessRule =
	| boolean
	| ((ctx: McpAccessRuleContext) => boolean | Promise<boolean>);

export type McpEntityPolicy =
	| boolean
	| {
			expose?: boolean;
			read?: boolean | McpAccessRule;
			write?: boolean | McpAccessRule;
			delete?: boolean | McpAccessRule;
			operations?: Record<string, boolean | McpAccessRule>;
			fields?: { include?: string[]; exclude?: string[] };
			description?: string;
	  };

export interface McpCrudDefaults {
	collections?: {
		read?: boolean | McpAccessRule;
		write?: boolean | McpAccessRule;
		delete?: boolean | McpAccessRule;
	};
	globals?: {
		read?: boolean | McpAccessRule;
		write?: boolean | McpAccessRule;
	};
}

export interface McpCrudConfig {
	defaults?: McpCrudDefaults;
	collections?: Record<string, McpEntityPolicy>;
	globals?: Record<string, McpEntityPolicy>;
	maxLimit?: number;
}

export interface McpRoutesConfig {
	exposeAnnotated?: boolean;
	routes?: Record<string, McpEntityPolicy>;
}

export interface McpResourcesConfig {
	schemas?: boolean;
	routes?: boolean;
}

export interface McpTransportConfig {
	accessMode?: McpAccessMode;
}

export interface McpHttpConfig extends McpTransportConfig {
	allowedOrigins?: string[];
	allowedHosts?: string[];
	enableJsonResponse?: boolean;
}

export interface McpStdioConfig extends McpTransportConfig {}

export interface McpConfig {
	name?: string;
	version?: string;
	crud?: McpCrudConfig;
	routes?: McpRoutesConfig;
	resources?: McpResourcesConfig;
	http?: McpHttpConfig;
	stdio?: McpStdioConfig;
}

export interface McpExecutionOptions {
	transport?: McpTransportKind;
	accessMode?: McpAccessMode;
	ctx?: AppContext & Partial<RequestContext>;
	request?: Request;
	config?: McpConfig;
}

export interface McpToolHandlerArgs<TInput = unknown> {
	input: TInput;
	ctx: AppContext & Partial<RequestContext>;
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	request?: Request;
}

export interface McpToolConfig<
	TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
	TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
	title?: string;
	description?: string;
	inputSchema?: TInputSchema;
	outputSchema?: TOutputSchema;
	annotations?: ToolAnnotations;
	access?: McpAccessRule;
	_meta?: Record<string, unknown>;
}

export interface McpToolDefinition<
	TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
	TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
> {
	readonly __brand: "mcpTool";
	readonly name: string;
	readonly config: McpToolConfig<TInputSchema, TOutputSchema>;
	readonly handler: (
		args: McpToolHandlerArgs<z.infer<TInputSchema>>,
	) => CallToolResult | Promise<CallToolResult>;
}

declare module "questpie" {
	interface AppStateConfig {
		mcp?: McpConfig;
	}

	interface ModuleDefinition {
		mcpTools?: Record<string, McpToolDefinition>;
	}
}
