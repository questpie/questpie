import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	createAdapterContext,
	createContextFactory,
	type AppContext,
	type RequestContext,
} from "questpie";

import type {
	McpAccessMode,
	McpExecutionOptions,
	McpTransportKind,
} from "./types.js";

export type QuestpieApp = Parameters<typeof createContextFactory>[0];

export interface RuntimeScope {
	app: QuestpieApp;
	transport: McpTransportKind;
	accessMode: McpAccessMode;
	request?: Request;
	getContext(): Promise<AppContext & Partial<RequestContext>>;
}

export function createRuntimeScope(
	app: QuestpieApp,
	options: McpExecutionOptions,
): RuntimeScope {
	const transport = options.transport ?? "http";
	const accessMode =
		options.accessMode ?? (transport === "stdio" ? "system" : "user");
	const createContext = createContextFactory(app);
	let requestContextPromise:
		| Promise<AppContext & Partial<RequestContext>>
		| undefined;

	return {
		app,
		transport,
		accessMode,
		request: options.request,
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

export function safeJsonStringify(value: unknown): string {
	return JSON.stringify(
		value,
		(_key, nestedValue) => {
			if (typeof nestedValue === "bigint") return nestedValue.toString();
			if (nestedValue instanceof Date) return nestedValue.toISOString();
			return nestedValue;
		},
		2,
	);
}

export function toToolResult(value: unknown): CallToolResult {
	if (
		value &&
		typeof value === "object" &&
		("content" in value || "structuredContent" in value || "isError" in value)
	) {
		const result = value as CallToolResult;
		if (!result.content) {
			return {
				...result,
				content: [
					{
						type: "text",
						text: safeJsonStringify(result.structuredContent ?? null),
					},
				],
			};
		}
		return result;
	}

	const structuredContent =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: { value };

	return {
		structuredContent,
		content: [{ type: "text", text: safeJsonStringify(value) }],
	};
}

export function toToolError(error: unknown): CallToolResult {
	const message = error instanceof Error ? error.message : String(error);
	return {
		isError: true,
		content: [{ type: "text", text: message }],
	};
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
