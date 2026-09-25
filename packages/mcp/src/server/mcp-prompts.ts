import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	ErrorCode,
	GetPromptRequestSchema,
	type GetPromptResult,
	GetPromptResultSchema,
	ListPromptsRequestSchema,
	type ListPromptsResult,
	McpError,
	type Prompt,
	PromptSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { ResolvedMcpCatalog } from "./catalog.js";
import {
	evaluateMcpRule,
	normalizeRequiredScopes,
	scopeGateAllows,
	scopesFromContext,
} from "./policy.js";
import type { RuntimeScope } from "./runtime.js";
import type {
	McpPromptHandlerArgs,
	McpPromptProviderConfig,
	McpPromptProviderDefinition,
} from "./types.js";

/**
 * Define an MCP prompt provider, contributed by a module the same way custom
 * tools are (via `ModuleDefinition.mcpPrompts`, file convention
 * `mcp-prompts/*.ts`). A provider answers `prompts/list` and `prompts/get`
 * per request, so the prompts a caller sees can depend on who the caller is.
 *
 * `access` and `scopes` compose exactly like a custom tool's: a caller the
 * provider denies sees none of its prompts, and `prompts/get` of any of them
 * answers not-found. `list` and `get` then run with that caller's context and
 * must apply their own row-level rules; returning `null` from `get` for a
 * prompt the caller cannot read keeps it indistinguishable from an unknown
 * name. Prompts are served on the `http` and `stdio` transports only, never to
 * remote workloads.
 *
 * @example
 * ```ts
 * export default mcpPrompts("playbooks", {
 *   access: ({ session }) => !!session,
 *   scopes: "playbooks:read",
 *   list: async ({ ctx }) =>
 *     (await ctx.collections.playbooks.find({})).docs.map((doc) => ({
 *       name: doc.slug,
 *       description: doc.summary,
 *     })),
 *   get: async ({ ctx, name }) => {
 *     const doc = await ctx.collections.playbooks.findOne({ where: { slug: name } });
 *     if (!doc) return null;
 *     return { messages: [{ role: "user", content: { type: "text", text: doc.body } }] };
 *   },
 * });
 * ```
 */
export function mcpPrompts(
	name: string,
	config: McpPromptProviderConfig,
): McpPromptProviderDefinition {
	return Object.freeze({
		__brand: "mcpPrompts" as const,
		name,
		config: Object.freeze({
			...config,
			scopes: Array.isArray(config.scopes) ? [...config.scopes] : config.scopes,
		}),
	});
}

export function isMcpPromptProvider(
	value: unknown,
): value is McpPromptProviderDefinition {
	if (!value || typeof value !== "object") return false;
	const candidate = value as {
		__brand?: unknown;
		config?: { list?: unknown; get?: unknown };
	};
	return (
		candidate.__brand === "mcpPrompts" &&
		typeof candidate.config?.list === "function" &&
		typeof candidate.config?.get === "function"
	);
}

async function promptProviderAllows(
	scope: RuntimeScope,
	provider: McpPromptProviderDefinition,
	ctx: Awaited<ReturnType<RuntimeScope["getContext"]>>,
): Promise<boolean> {
	const allowed = await evaluateMcpRule(provider.config.access, {
		transport: scope.transport,
		accessMode: scope.accessMode,
		ctx,
	});
	return (
		allowed &&
		scopeGateAllows(
			scopesFromContext(ctx),
			normalizeRequiredScopes(provider.config.scopes),
		)
	);
}

const MAX_INVALID_PARAMS_MESSAGE_CHARS = 512;

/**
 * A provider's own `McpError(ErrorCode.InvalidParams, …)` is the one error
 * that reaches the client as itself: it states what was wrong with the
 * caller's arguments, which the provider authored for the caller. Every other
 * throw stays the boundary's opaque `internal`.
 */
function providerInvalidParams(error: unknown): McpError | undefined {
	if (!(error instanceof McpError) || error.code !== ErrorCode.InvalidParams) {
		return undefined;
	}
	const message = error.message
		.replace(/^MCP error -?\d+: /, "")
		.slice(0, MAX_INVALID_PARAMS_MESSAGE_CHARS);
	return new McpError(ErrorCode.InvalidParams, message);
}

/**
 * Install `prompts/list` and `prompts/get` over the released providers. The
 * caller must declare the `prompts` capability on the server beforehand.
 */
export function registerPromptProviders(
	server: McpServer,
	scope: RuntimeScope,
	catalog: ResolvedMcpCatalog,
): void {
	if (scope.workload || catalog.promptProviders.size === 0) return;
	const providers = [...catalog.promptProviders.values()].map(
		(entry) => entry.provider,
	);

	server.server.setRequestHandler(
		ListPromptsRequestSchema,
		(request, extra): Promise<ListPromptsResult> => {
			// One page holds every prompt and no `nextCursor` is ever issued, so
			// any cursor is one this server never gave out.
			if (request.params?.cursor) {
				throw new McpError(ErrorCode.InvalidParams, "Invalid cursor");
			}
			return scope.execution.execute({
				operation: "prompts/list",
				transport: scope.transport,
				accessMode: scope.accessMode,
				input: request.params ?? {},
				extra,
				authorize: () => scope.getContext(),
				invoke: async (control) => {
					const handlerArgs: McpPromptHandlerArgs = {
						...control,
						transport: scope.transport,
						accessMode: scope.accessMode,
						request: scope.request,
					};
					const prompts: Prompt[] = [];
					const names = new Set<string>();
					for (const provider of providers) {
						if (!(await promptProviderAllows(scope, provider, control.ctx))) {
							continue;
						}
						for (const candidate of await provider.config.list(handlerArgs)) {
							const parsed = PromptSchema.safeParse(candidate);
							if (!parsed.success) {
								throw new Error("MCP prompt provider listed an invalid prompt");
							}
							// Release order decides a name two providers both claim;
							// `prompts/get` asks providers in the same order.
							if (names.has(parsed.data.name)) continue;
							names.add(parsed.data.name);
							prompts.push(parsed.data);
						}
					}
					return { prompts };
				},
			});
		},
	);

	server.server.setRequestHandler(
		GetPromptRequestSchema,
		async (request, extra): Promise<GetPromptResult> => {
			let invalidParams: McpError | undefined;
			const rendered = await scope.execution.execute({
				operation: "prompts/get",
				transport: scope.transport,
				accessMode: scope.accessMode,
				input: request.params,
				extra,
				authorize: () => scope.getContext(),
				invoke: async (control): Promise<GetPromptResult | null> => {
					for (const provider of providers) {
						if (!(await promptProviderAllows(scope, provider, control.ctx))) {
							continue;
						}
						let result: GetPromptResult | null | undefined;
						try {
							result = await provider.config.get({
								...control,
								transport: scope.transport,
								accessMode: scope.accessMode,
								request: scope.request,
								name: request.params.name,
								arguments: { ...request.params.arguments },
							});
						} catch (error) {
							invalidParams = providerInvalidParams(error);
							if (!invalidParams) throw error;
							return null;
						}
						if (result === null || result === undefined) continue;
						const parsed = GetPromptResultSchema.safeParse(result);
						if (!parsed.success) {
							throw new Error("MCP prompt provider rendered an invalid prompt");
						}
						return parsed.data;
					}
					return null;
				},
			});
			if (invalidParams) throw invalidParams;
			if (!rendered) {
				// Same answer for an unknown name and a prompt this caller cannot
				// read, so absence discloses nothing.
				throw new McpError(ErrorCode.InvalidParams, "Prompt not found");
			}
			return rendered;
		},
	);
}
