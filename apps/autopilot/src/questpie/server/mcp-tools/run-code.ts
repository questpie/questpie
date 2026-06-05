import type { AppContext } from "questpie";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import {
	knowledgeScope,
	knowledgeWhere,
	mcpJson,
	requireMcpCaller,
} from "../lib/mcp-tool-helpers";

/**
 * `run_code` — code-mode agent tool (TRUSTED executor path).
 *
 * Replaces N discrete MCP tool calls with ONE: the agent writes a short
 * TypeScript script that calls the framework API directly (query a collection,
 * transform, write a knowledge note, …) and gets back the script's return value
 * plus its console logs in a single round-trip. This is the Anthropic/Cloudflare
 * "code execution with MCP" / "code mode" pattern — fewer tokens (1 turn vs N),
 * and expressive (loops / joins / conditionals the discrete tools can't do).
 *
 * Trust model (design §13): the agent is ALREADY trusted (it can call the MCP
 * tools directly), so code-mode uses `ctx.executor.run(..., isolation:"trusted")`
 * — the script runs IN-PROCESS with a scoped view of the real app `ctx`. It is
 * NOT the Deno sandbox / bindings broker (those are the untrusted mini-app path).
 *
 * Exposed surface (MVP, names mirror server-side `ctx` per design §14):
 *   globalThis.questpie.knowledge.read/write/list   (file-as-DB)
 *   globalThis.questpie.collections.<name>.find/findOne   (query)
 * Each method delegates to the SAME business logic as the discrete MCP tools
 * (no duplicated logic). The script reads `globalThis.questpie` at call time and
 * `export default`s an async function that receives the tool's optional `input`.
 */

const SCOPE_FIELDS = ["company", "project", "task"] as const;

const scopeSchema = z
	.object({
		scope_type: z.enum(SCOPE_FIELDS).optional(),
		scope_id: z.string().optional(),
		project_id: z.string().optional(),
		task_id: z.string().optional(),
	})
	.optional();

type ScopeArg = z.infer<typeof scopeSchema>;

/**
 * Build the scoped, capability-named API handed to the guest script. Every
 * method reuses the existing MCP business logic (knowledge scope/where helpers,
 * `knowledgeResource.createTextResource`, `ctx.collections.*`), so code-mode and
 * the discrete tools stay behaviorally identical.
 */
function buildCodeModeApi(
	ctx: AppContext & { session?: unknown },
	actorId: string,
) {
	const collections = ctx.collections as Record<
		string,
		{
			find: (args: unknown) => Promise<{ docs: unknown[] }>;
			findOne: (args: unknown) => Promise<unknown>;
		}
	>;

	const knowledge = {
		async list(args?: { path?: string; scope?: ScopeArg }) {
			const scope = args?.scope ?? {};
			const result = await ctx.collections.knowledge.find({
				where: knowledgeWhere(scope),
				limit: 500,
				orderBy: { path: "asc" },
			});
			const docs = result.docs as Array<{ path?: string | null }>;
			return args?.path
				? docs.filter((doc) => doc.path?.startsWith(args.path as string))
				: docs;
		},

		async read(args: { path: string; scope?: ScopeArg }) {
			return ctx.collections.knowledge.findOne({
				where: knowledgeWhere({ ...(args.scope ?? {}), path: args.path }),
			});
		},

		async write(args: {
			path: string;
			content: string;
			title?: string;
			mime_type?: string;
			scope?: ScopeArg;
		}) {
			const scope = knowledgeScope(args.scope ?? {});
			const existing = await ctx.collections.knowledge.findOne({
				where: knowledgeWhere({ ...(args.scope ?? {}), path: args.path }),
			});

			const data = {
				title: args.title ?? args.path.split("/").at(-1) ?? args.path,
				path: args.path,
				body: args.content,
				contentType: args.mime_type ?? "text/markdown",
				scopeType: scope.scopeType,
				project: scope.projectId,
				task: scope.taskId,
				kind: "document" as const,
				source: "mcp" as const,
				sourceRef: actorId,
			};

			return existing
				? ctx.collections.knowledge.updateById({
						id: (existing as { id: string }).id,
						data,
					})
				: ctx.services.knowledgeResource.createTextResource({
						title: data.title,
						path: data.path,
						body: data.body,
						contentType: data.contentType,
						scopeType: data.scopeType,
						projectId: data.project,
						taskId: data.task,
						kind: "document",
						source: "mcp",
						sourceRef: data.sourceRef,
					});
		},
	};

	// Read-only collection query surface (MVP). Mutations go through the typed
	// services / knowledge above; broad write access is deferred to the
	// capability broker on the untrusted path.
	const collectionsProxy = new Proxy(
		{},
		{
			get(_t, name: string) {
				const col = collections[name];
				if (!col) return undefined;
				return {
					find: (args: unknown) => col.find(args ?? {}),
					findOne: (args: unknown) => col.findOne(args ?? {}),
				};
			},
		},
	);

	return { knowledge, collections: collectionsProxy };
}

export const runCode = mcpTool("run_code", {
	title: "Run code",
	description:
		"Execute a short TypeScript script in ONE call instead of chaining many " +
		"tool calls. The script `export default`s an async function(input) and may " +
		"call `globalThis.questpie.knowledge.{read,write,list}` and " +
		"`globalThis.questpie.collections.<name>.{find,findOne}`. Returns the " +
		"script's return value plus its console logs. Use this to query, transform, " +
		"and write data together (loops/joins/conditionals) without round-tripping.",
	inputSchema: z.object({
		source: z
			.string()
			.min(1)
			.describe(
				"TypeScript that `export default`s an async function(input). Access the " +
					"app via `globalThis.questpie` (knowledge, collections).",
			),
		input: z
			.unknown()
			.optional()
			.describe("Optional payload passed to the script's default function."),
		timeout_ms: z
			.number()
			.int()
			.positive()
			.max(120_000)
			.optional()
			.describe("Soft wall-clock timeout (ms). Default 30000."),
	}),
}).handler(async ({ input, ctx, request, accessMode }) => {
	const caller = await requireMcpCaller({ ctx, request, accessMode });

	const executor = ctx.executor as
		| {
				isEnabled?: boolean;
				run: (opts: {
					source: string;
					input?: unknown;
					isolation: "trusted";
					capabilities?: { timeoutMs?: number };
					bindings?: Record<string, unknown>;
				}) => Promise<{
					ok: boolean;
					output?: unknown;
					logs: string[];
					error?: string;
					timedOut?: boolean;
					ms?: number;
				}>;
		  }
		| undefined;

	if (!executor || executor.isEnabled === false) {
		return mcpJson({
			ok: false,
			error:
				"executor is not configured. Set `executor` in the Questpie config " +
				"(the trusted in-process adapter is built in and enabled once " +
				"`executor` is present).",
		});
	}

	// Expose the scoped API to the guest as `globalThis.questpie` (mirrors the
	// executor's `__secrets` convention) — the guest reads it at call time. We
	// pass it as `bindings` so the trusted in-process adapter sets AND restores it
	// INSIDE its serialization mutex; that way concurrent trusted runs (the
	// multi-agent worker fleet / `schedule-tick` cron) never read each other's
	// `questpie` ctx — see in-process.ts. Setting it here on globalThis would be
	// OUTSIDE the lock and would re-introduce the cross-contamination race.
	//
	// NOTE: the trusted in-process soft timeout (Promise.race) cannot preempt a
	// synchronous infinite loop — acceptable for trusted, agent-authored code in
	// MVP. Real preemption is the untrusted-sandbox concern tracked in
	// `executor-prod-gate-hardening`.
	const api = buildCodeModeApi(ctx, caller.actorId);

	const result = await executor.run({
		source: input.source,
		input: input.input,
		isolation: "trusted",
		capabilities: input.timeout_ms
			? { timeoutMs: input.timeout_ms }
			: undefined,
		bindings: { questpie: api },
	});

	return mcpJson({
		ok: result.ok,
		output: result.output,
		logs: result.logs,
		error: result.error,
		timed_out: result.timedOut ?? false,
		ms: result.ms,
	});
});
