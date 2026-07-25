import { randomUUID } from "node:crypto";

import {
	customToolAllows,
	customToolDescriptor,
	customToolWorkloadIdentity,
	executeCustomToolCall,
} from "./custom-tools.js";
import {
	assertBoundedMcpValue,
	McpAccessDeniedError,
	McpPublicError,
	mcpPublicErrorCode,
	toMcpToolError,
} from "./execution-boundary.js";
import { createWorkloadMcpRelease } from "./release.js";
import { createRuntimeScope, type QuestpieApp } from "./runtime.js";
import type {
	McpProgrammaticTool,
	McpProgrammaticToolResult,
	McpWorkloadToolPort,
	WorkloadMcpServerOptions,
} from "./types.js";
import {
	authorizeWorkload,
	createWorkloadMcpBoundary,
} from "./workload-boundary.js";

const defaultSignal = () => new AbortController().signal;

/**
 * Programmatic, custom-tool-only workload port. This is deliberately not a
 * general in-process MCP client: CRUD, routes, resources, and transport
 * authority are absent by construction.
 */
export function createWorkloadMcpToolPort(
	app: QuestpieApp,
	options: WorkloadMcpServerOptions,
): McpWorkloadToolPort {
	const workload = createWorkloadMcpBoundary(options);
	const release = createWorkloadMcpRelease(app, options.config);
	const scope = createRuntimeScope(
		app,
		{
			transport: "workload",
			accessMode: "user",
			config: release.config,
		},
		release.execution,
		workload,
	);

	const port: McpWorkloadToolPort = {
		async listCustomTools(request = {}) {
			const tools: McpProgrammaticTool[] = [];
			const controller = new AbortController();
			let timedOut = false;
			const cancel = () => controller.abort(request.signal?.reason);
			if (request.signal?.aborted) cancel();
			else request.signal?.addEventListener("abort", cancel, { once: true });
			const timer = setTimeout(() => {
				timedOut = true;
				controller.abort(new Error("MCP list deadline exceeded"));
			}, release.execution.limits.timeoutMs);
			const extra = {
				signal: controller.signal,
				requestId: request.requestId ?? randomUUID(),
			};
			try {
				if (controller.signal.aborted) {
					throw new McpPublicError(timedOut ? "timeout" : "cancelled");
				}
				for (const [toolName, { tool }] of release.catalog.customTools) {
					if (!tool.config.workload) continue;
					const identity = customToolWorkloadIdentity(toolName, tool);
					try {
						let workloadAuthorization:
							| Awaited<ReturnType<typeof authorizeWorkload>>
							| undefined;
						const descriptor = await scope.execution.execute({
							operation: "tools/list",
							transport: "workload",
							accessMode: "user",
							input: { name: toolName },
							extra,
							authorize: async (control) => {
								workloadAuthorization = await authorizeWorkload(
									workload,
									"discovery",
									identity,
									tool.config.workload,
									control,
								);
								if (
									!workloadAuthorization ||
									!(await customToolAllows(
										scope,
										tool,
										workloadAuthorization.context,
									))
								) {
									throw new McpAccessDeniedError();
								}
								return workloadAuthorization.context;
							},
							concurrencyKey: () => workloadAuthorization?.concurrencyKey,
							invoke: async () => customToolDescriptor(toolName, tool),
						});
						tools.push(descriptor as McpProgrammaticTool);
					} catch (error) {
						if (mcpPublicErrorCode(error) === "access_denied") {
							continue;
						}
						if (timedOut && mcpPublicErrorCode(error) === "cancelled") {
							throw new McpPublicError("timeout");
						}
						throw error;
					}
				}
				assertBoundedMcpValue(
					{ tools },
					{
						maxBytes: release.execution.limits.maxOutputBytes,
						maxValueDepth: release.execution.limits.maxOutputDepth,
						maxValueNodes: release.execution.limits.maxValueNodes,
					},
					"output_too_large",
				);
				return { tools };
			} finally {
				clearTimeout(timer);
				request.signal?.removeEventListener("abort", cancel);
			}
		},

		async callCustomTool(request) {
			const entry =
				typeof request?.name === "string" && request.name.length <= 256
					? release.catalog.customTools.get(request.name)
					: undefined;
			if (!entry?.tool.config.workload) {
				return toMcpToolError(
					new McpPublicError("access_denied"),
				) as McpProgrammaticToolResult;
			}
			try {
				return (await executeCustomToolCall(
					scope,
					request.name,
					entry.tool,
					request.input,
					{
						signal: request.signal ?? defaultSignal(),
						requestId: request.requestId ?? randomUUID(),
					},
				)) as McpProgrammaticToolResult;
			} catch (error) {
				return toMcpToolError(error) as McpProgrammaticToolResult;
			}
		},
	};
	return Object.freeze(port);
}
