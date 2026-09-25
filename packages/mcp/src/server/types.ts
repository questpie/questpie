import type {
	CallToolResult,
	GetPromptResult,
	Prompt,
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
			/** Allow callers to expand relation fields with `with`. Defaults to true. */
			relationLoading?: boolean;
			description?: string;
	  };

export interface McpCrudConfig {
	collections?: Record<string, McpEntityPolicy>;
	globals?: Record<string, McpEntityPolicy>;
	maxLimit?: number;
}

export interface McpRoutesConfig {
	routes?: Record<string, McpEntityPolicy>;
}

export interface McpResourcesConfig {
	collections?: Record<string, boolean>;
	globals?: Record<string, boolean>;
	routes?: Record<string, boolean>;
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

export interface McpExecutionLimits {
	/** Maximum serialized tool input accepted after protocol decoding. */
	maxInputBytes?: number;
	/** Maximum object/array nesting accepted in decoded operation input. */
	maxInputDepth?: number;
	/** Maximum object/array nesting accepted in operation output. */
	maxOutputDepth?: number;
	/** Maximum object properties and array entries visited per value. */
	maxValueNodes?: number;
	/** Maximum serialized tool result returned to a caller. */
	maxOutputBytes?: number;
	/** Wall-clock budget for authorization plus execution. */
	timeoutMs?: number;
	/** Maximum in-flight operations for one released app snapshot. */
	maxConcurrency?: number;
	/** Maximum in-flight operations for one resolved caller principal. */
	maxConcurrencyPerPrincipal?: number;
	/** Maximum released tools across custom, CRUD, and route catalogs. */
	maxTools?: number;
	/** Maximum released schema resources. */
	maxResources?: number;
}

export type McpPublicErrorCode =
	| "access_denied"
	| "invalid_input"
	| "input_too_large"
	| "output_too_large"
	| "timeout"
	| "cancelled"
	| "busy"
	| "internal";

export interface McpExecutionDiagnosticEvent {
	correlationId: string;
	requestId?: string | number;
	transport: McpTransportKind;
	operation: string;
	durationMs: number;
	outcome: "completed" | "rejected";
	code?: McpPublicErrorCode;
	/**
	 * Bounded and credential-redacted. Inputs, outputs, sessions, authorization
	 * envelopes, and workload attribution are never included.
	 */
	internalError?: {
		kind: "Error" | "Unknown";
	};
}

export interface McpExecutionConfig extends McpExecutionLimits {
	/**
	 * Trusted server-side diagnostics sink. At most one unresolved callback is
	 * retained; subsequent events are dropped until it settles.
	 */
	onDiagnostic?: (
		event: Readonly<McpExecutionDiagnosticEvent>,
	) => void | Promise<void>;
}

export interface McpConfig {
	name?: string;
	version?: string;
	crud?: McpCrudConfig;
	routes?: McpRoutesConfig;
	resources?: McpResourcesConfig;
	http?: McpHttpConfig;
	stdio?: McpStdioConfig;
	execution?: McpExecutionConfig;
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

export interface McpWorkloadExecutionControl {
	signal: AbortSignal;
	requestId: string | number;
	correlationId: string;
}

export interface McpWorkloadAuthorizer {
	authorize(
		request: McpWorkloadAuthorizationRequest,
		control?: McpWorkloadExecutionControl,
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
		control?: McpWorkloadExecutionControl,
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
	/**
	 * Stable, non-secret consumer/tenant key for per-principal concurrency.
	 * Independent workload boundaries with different keys cannot exhaust one
	 * another's per-principal bucket. Omitted keys are isolated per boundary.
	 */
	concurrencyKey?: string;
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
	signal: AbortSignal;
	requestId: string | number;
	correlationId: string;
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
	signal: AbortSignal;
	requestId: string | number;
	correlationId: string;
}

export interface McpProgrammaticRequestOptions {
	signal?: AbortSignal;
	requestId?: string | number;
}

export interface McpProgrammaticTool {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: ToolAnnotations;
	_meta?: Record<string, unknown>;
}

export interface McpProgrammaticToolResult {
	content: Array<{ type: string; [key: string]: unknown }>;
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
	_meta?: Record<string, unknown>;
}

export interface McpWorkloadToolPort {
	listCustomTools(
		options?: McpProgrammaticRequestOptions,
	): Promise<{ tools: McpProgrammaticTool[] }>;
	callCustomTool(input: {
		name: string;
		input: unknown;
		signal?: AbortSignal;
		requestId?: string | number;
	}): Promise<McpProgrammaticToolResult>;
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
	access: McpAccessRule;
	/**
	 * Scopes an OAuth caller must hold to reach this custom tool (all required —
	 * AND), or `false` as an explicit no-OAuth-scope policy. Custom tools have no
	 * default mapping, so omission keeps the tool out of the released catalog. Enforced by the
	 * scope gate (`scopeGateAllows`) at both `tools/list` (hidden) and
	 * `tools/call` (denied); `system`/`user` callers carry no scopes and skip it.
	 */
	scopes: McpRequiredScopes;
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

/** Per-request arguments shared by a prompt provider's `list` and `get`. */
export interface McpPromptHandlerArgs {
	ctx: AppContext & Partial<RequestContext>;
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	request?: Request;
	signal: AbortSignal;
	requestId: string | number;
	correlationId: string;
}

export interface McpPromptGetArgs extends McpPromptHandlerArgs {
	/** The prompt name the client asked for, exactly as sent. */
	name: string;
	/** The client's string arguments; `{}` when the client sent none. */
	arguments: Record<string, string>;
}

export interface McpPromptProviderConfig {
	/**
	 * Required explicit opt-in, evaluated per request against the same caller
	 * context the tools get. A denied caller sees none of this provider's prompts
	 * and a `prompts/get` of any of them answers not-found.
	 */
	access: McpAccessRule;
	/**
	 * Scopes an OAuth caller must hold (all required — AND), or `false` for an
	 * explicit no-OAuth-scope policy. Required, like a custom tool's `scopes`.
	 */
	scopes: McpRequiredScopes;
	/**
	 * The prompts this caller can use right now. Runs on every `prompts/list`;
	 * the list may differ per caller and per request.
	 */
	list: (args: McpPromptHandlerArgs) => Prompt[] | Promise<Prompt[]>;
	/**
	 * Render one prompt, or return `null` when this caller has no prompt of
	 * that name. `null` is answered as not-found, the same as an unknown name,
	 * so a prompt the caller cannot read is indistinguishable from none.
	 */
	get: (
		args: McpPromptGetArgs,
	) => GetPromptResult | null | Promise<GetPromptResult | null>;
}

export interface McpPromptProviderDefinition {
	readonly __brand: "mcpPrompts";
	readonly name: string;
	readonly config: McpPromptProviderConfig;
}

declare module "questpie" {
	interface AppStateConfig {
		mcp?: McpConfig;
	}

	interface ModuleDefinition {
		mcpTools?: Record<string, McpToolDefinition>;
		mcpPrompts?: Record<string, McpPromptProviderDefinition>;
	}
}
