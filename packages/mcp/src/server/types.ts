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
	/**
	 * The consented OAuth scopes carried by the caller, when the request was
	 * authenticated by an OAuth access token (`ctx.principal.kind === "oauth"`).
	 * `undefined` for the `user` (first-party) and `system` (stdio/trusted)
	 * principals, which carry no scopes. This is the model input the scope gate
	 * (`scopeGateAllows`) reads when deciding whether a tool is visible/callable.
	 */
	scopes?: string[];
	ctx: AppContext & Partial<RequestContext>;
}

export type McpAccessRule =
	| boolean
	| ((ctx: McpAccessRuleContext) => boolean | Promise<boolean>);

/**
 * OAuth scope requirement declaration. A single scope string, a list (all
 * required — AND), or `false` to explicitly require no scope (public even to
 * scoped OAuth callers). `undefined` means "fall back to the default mapping".
 */
export type McpRequiredScopes = string | string[] | false;

export type McpEntityPolicy =
	| boolean
	| {
			expose?: boolean;
			read?: boolean | McpAccessRule;
			write?: boolean | McpAccessRule;
			delete?: boolean | McpAccessRule;
			operations?: Record<string, boolean | McpAccessRule>;
			/**
			 * Scopes an OAuth caller must hold to reach this entity. Declarable at
			 * the entity level (applies to every operation) and/or per operation via
			 * {@link McpEntityPolicy.operationScopes}. When omitted, the default
			 * operation→scope mapping is derived from the operation kind (e.g.
			 * `collections:<name>:read`). Resolved by `requiredScopesForOperation`
			 * and enforced by the scope gate (`scopeGateAllows`) at both
			 * `tools/list` and `tools/call`.
			 */
			requiredScopes?: McpRequiredScopes;
			/**
			 * Per-operation scope requirements, keyed by operation name
			 * (`list`/`get`/`create`/`update`/`delete`/`invoke`/…). Overrides both
			 * {@link McpEntityPolicy.requiredScopes} and the default mapping for the
			 * named operation.
			 */
			operationScopes?: Record<string, McpRequiredScopes>;
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
	/**
	 * Scopes an OAuth caller must hold to reach this custom tool (all required —
	 * AND). Custom tools have no default mapping (there is no resource/operation
	 * to derive one from), so an omitted value requires no scope. Enforced by the
	 * scope gate (`scopeGateAllows`) at both `tools/list` (hidden) and
	 * `tools/call` (denied); `system`/`user` callers carry no scopes and skip it.
	 */
	scopes?: McpRequiredScopes;
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
