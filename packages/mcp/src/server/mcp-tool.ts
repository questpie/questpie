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

/**
 * Define a custom MCP tool, contributed by a module the same way collections and
 * routes are (via `ModuleDefinition.mcpTools`). `mcpTool(name, config).handler(fn)`
 * returns a frozen, branded {@link McpToolDefinition}; the CRUD/route tools the
 * framework auto-generates are the same shape.
 *
 * `config` mirrors the MCP tool contract: `inputSchema`/`outputSchema` (Zod),
 * `title`/`description`/`annotations` for discovery, plus the two QUESTPIE
 * authorization hooks that compose exactly like the built-in tools:
 * - `access` — required explicit opt-in and an {@link McpAccessRule} run against the caller's transport /
 *   accessMode / session (and, for an OAuth caller, its scopes). Same RBAC-style
 *   gate the CRUD tools use.
 * - `scopes` — the OAuth scopes an `oauth` caller must hold ({@link McpToolConfig.scopes}).
 *   Custom tools have no default scope mapping (unlike CRUD, there is no
 *   resource/operation to derive one from), so it is required; use `false` for
 *   an explicit no-OAuth-scope policy. The shipped scope gate ({@link scopeGateAllows}) enforces this at both
 *   `tools/list` (hidden) and `tools/call` (denied); `system`/`user` callers
 *   carry no scopes and skip it, so the effective bound is always `scopes ∩ RBAC`.
 *
 * @example
 * ```ts
 * export const ping = mcpTool("ops.ping", {
 *   access: ({ session }) => !!session,
 *   description: "Health probe",
 *   inputSchema: z.object({}),
 *   scopes: "routes:ops/ping:invoke", // only OAuth callers holding this scope
 * }).handler(async () => ({ content: [{ type: "text", text: "pong" }] }));
 * ```
 */
export function mcpTool<
	TInputSchema extends z.ZodTypeAny = z.ZodTypeAny,
	TOutputSchema extends z.ZodTypeAny = z.ZodTypeAny,
>(
	name: string,
	config: McpToolConfig<TInputSchema, TOutputSchema>,
): McpToolBuilder<TInputSchema, TOutputSchema> {
	return new McpToolBuilder(name, config);
}

export function isMcpTool(value: unknown): value is McpToolDefinition {
	return (
		!!value &&
		typeof value === "object" &&
		(value as { __brand?: unknown })["__brand"] === "mcpTool" &&
		typeof (value as { handler?: unknown }).handler === "function"
	);
}
