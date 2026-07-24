import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";
import type { z } from "zod";

export type McpTransportKind = "http" | "stdio" | "workload";

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

export interface McpWorkloadRequirement {
	/** Named facts interpreted exclusively by the consumer-supplied authorizer. */
	capabilities: readonly string[];
	/** Optional named capability delegated to the opaque execution handoff. */
	handoff?: string;
}

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
			workload?: McpWorkloadRequirement;
			operationWorkloads?: Record<string, McpWorkloadRequirement>;
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

export interface McpStdioConfig {
	/**
	 * Explicitly grants this local stdio process maintenance authority. Without
	 * this flag, stdio requires an exact user-mode `ctx`.
	 */
	trustedMaintenance?: boolean;
}

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

export interface McpWorkloadAuthorizationRequest {
	phase: "discovery" | "call";
	envelope: unknown;
	tool: McpWorkloadToolFacts;
}

export type McpWorkloadToolKind = "custom" | "collection" | "global" | "route";

export interface McpWorkloadToolFacts {
	kind: McpWorkloadToolKind;
	name: string;
	operation: string;
	intent: "read" | "effect";
	transport: "workload";
	capabilities: readonly string[];
	handoff?: string;
}

export interface McpWorkloadAuthorization {
	context: unknown;
	attribution?: unknown;
}

export interface McpWorkloadAuthorizer {
	authorize(
		request: McpWorkloadAuthorizationRequest,
	): McpWorkloadAuthorization | null | Promise<McpWorkloadAuthorization | null>;
}

export interface McpWorkloadContextBindingInput {
	authorizationContext: unknown;
	attribution?: unknown;
	tool: McpWorkloadToolFacts;
}

export interface McpWorkloadContextBinder {
	/**
	 * Bind opaque authorization to the exact user-mode QUESTPIE context used for
	 * access rechecks and execution. System-mode contexts fail closed.
	 */
	bind(
		input: McpWorkloadContextBindingInput,
	):
		| (AppContext & Partial<RequestContext>)
		| Promise<AppContext & Partial<RequestContext>>;
}

/**
 * Remote workload execution is intentionally not an {@link McpExecutionOptions}
 * variant. It cannot inherit HTTP request identity, cookies, OAuth, requester
 * sessions, access-mode overrides, or the stdio system default.
 */
export interface WorkloadMcpServerOptions {
	envelope: unknown;
	authorizer: McpWorkloadAuthorizer;
	contextBinder: McpWorkloadContextBinder;
	config?: McpConfig;
	audit?: (event: McpWorkloadAuditEvent) => void | Promise<void>;
	handoff?: McpWorkloadHandoff;
}

export interface McpWorkloadHandoffInput {
	authorizationContext: unknown;
	attribution?: unknown;
	toolName: string;
	capability: string;
	tool: McpWorkloadToolFacts;
	metadata: unknown;
	invoke: () => CallToolResult | Promise<CallToolResult>;
}

export interface McpWorkloadHandoff {
	execute(
		input: McpWorkloadHandoffInput,
	): CallToolResult | Promise<CallToolResult>;
}

export interface McpWorkloadAuditEvent {
	phase: "discovery" | "call";
	decision: "allowed" | "denied";
	toolName?: string;
	reason?: "authorization_denied" | "authorization_invalid" | "context_invalid";
	attribution?: unknown;
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
	/** Explicit, fail-closed authority contract for remote workload execution. */
	workload?: McpWorkloadRequirement;
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
