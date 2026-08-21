import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	createAdapterContext,
	createContextFactory,
	type AppContext,
	type RequestContext,
} from "questpie";

import type { McpExecutionBoundary } from "./execution-boundary.js";
import {
	McpPublicError,
	snapshotBoundedMcpValue,
	toMcpToolError,
} from "./execution-boundary.js";
import type {
	McpAccessMode,
	McpExecutionOptions,
	McpTransportKind,
} from "./types.js";
import type { WorkloadMcpBoundary } from "./workload-boundary.js";

export type QuestpieApp = Parameters<typeof createContextFactory>[0];

export interface RuntimeScope {
	app: QuestpieApp;
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	request?: Request;
	workload?: WorkloadMcpBoundary;
	execution: McpExecutionBoundary;
	getContext(): Promise<AppContext & Partial<RequestContext>>;
}

export function createRuntimeScope(
	app: QuestpieApp,
	options: McpExecutionOptions,
	execution: McpExecutionBoundary,
	workload?: WorkloadMcpBoundary,
): RuntimeScope {
	const transport = options.transport ?? "http";
	const accessMode = options.accessMode ?? "user";
	const createContext = createContextFactory(app);
	let requestContextPromise:
		| Promise<AppContext & Partial<RequestContext>>
		| undefined;

	return {
		app,
		transport,
		accessMode,
		request: options.request,
		workload,
		execution,
		async getContext() {
			if (options.ctx) return options.ctx;
			if (options.request) {
				requestContextPromise ??= createAdapterContext(app, options.request, {
					accessMode,
				}).then(
					(adapterContext) =>
						({
							...adapterContext.appContext,
							request: options.request,
						}) as unknown as AppContext & Partial<RequestContext>,
				);
				return requestContextPromise;
			}
			return createContext({
				accessMode,
			}) as Promise<AppContext & Partial<RequestContext>>;
		},
	};
}

export function toRequestContext(
	ctx: AppContext & Partial<RequestContext>,
	accessMode: McpAccessMode,
): RequestContext {
	return {
		session: ctx.session,
		principal: ctx.principal,
		actor: ctx.actor,
		locale: ctx.locale,
		defaultLocale: ctx.defaultLocale,
		localeFallback: ctx.localeFallback,
		accessMode: ctx.accessMode ?? accessMode,
		stage: ctx.stage,
		requestId: ctx.requestId,
		traceId: ctx.traceId,
		workload: ctx.workload,
		logger: ctx.logger,
		db: ctx.db,
		request: ctx.request,
		"~contextExtensions": ctx["~contextExtensions"],
	};
}

const MAX_MCP_RUNTIME_JSON_BYTES = 4 * 1024 * 1024;
const UTF8_ENCODER = new TextEncoder();

function runtimeSnapshot(value: unknown) {
	return snapshotBoundedMcpValue(
		value,
		{
			maxBytes: MAX_MCP_RUNTIME_JSON_BYTES,
			maxValueDepth: 64,
			maxValueNodes: 100_000,
		},
		"output_too_large",
	);
}

function stringifyRuntimeSnapshot(value: ReturnType<typeof runtimeSnapshot>) {
	const serialized = JSON.stringify(value, null, 2);
	if (UTF8_ENCODER.encode(serialized).byteLength > MAX_MCP_RUNTIME_JSON_BYTES) {
		throw new McpPublicError("output_too_large");
	}
	return serialized;
}

export function safeJsonStringify(value: unknown): string {
	return stringifyRuntimeSnapshot(runtimeSnapshot(value));
}

export function toToolResult(value: unknown): CallToolResult {
	const snapshot = runtimeSnapshot(value);
	const structuredContent =
		snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)
			? snapshot
			: { value: snapshot };

	return {
		structuredContent,
		content: [{ type: "text", text: stringifyRuntimeSnapshot(snapshot) }],
	};
}

export function toToolError(error: unknown): CallToolResult {
	return toMcpToolError(error);
}

export function jsonResource(uri: string, value: unknown) {
	return {
		contents: [
			{
				uri,
				mimeType: "application/json",
				text: safeJsonStringify(value),
			},
		],
	};
}
