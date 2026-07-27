import { randomUUID } from "node:crypto";
import { types as nodeTypes } from "node:util";

import type {
	CallToolResult,
	ListToolsResult,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";

import {
	assertBoundedMcpValue,
	McpAccessDeniedError,
	type McpExecutionBoundary,
	type McpHandlerExtra,
	McpPublicError,
	mcpPublicErrorCode,
} from "./execution-boundary.js";
import type {
	McpWorkloadAuthorization,
	McpWorkloadAuthorizationRequest,
	McpWorkloadAuditEvent,
	McpWorkloadContextBindingInput,
	McpWorkloadExecutionControl,
	McpWorkloadHandoffInput,
	McpWorkloadRequirement,
	McpWorkloadToolFacts,
	WorkloadMcpServerOptions,
} from "./types.js";

const PUBLIC_ACCESS_DENIED = "MCP access denied";

export type WorkloadToolIdentity = Omit<
	McpWorkloadToolFacts,
	"capabilities" | "handoff" | "transport"
>;

interface WorkloadDiscoveryTool {
	tool: Tool;
	identity: WorkloadToolIdentity;
	requirement: McpWorkloadRequirement;
	allows(ctx: AppContext & Partial<RequestContext>): boolean | Promise<boolean>;
}

export interface AuthorizedWorkload {
	readonly authorization: McpWorkloadAuthorization;
	readonly concurrencyKey: string;
	readonly context: AppContext & Partial<RequestContext>;
	readonly tool: McpWorkloadToolFacts;
}

export interface WorkloadMcpBoundary {
	readonly envelope: unknown;
	readonly concurrencyKey: string;
	readonly authorize: (
		request: McpWorkloadAuthorizationRequest,
		control?: McpWorkloadExecutionControl,
	) => unknown | Promise<unknown>;
	readonly bindContext: (
		input: McpWorkloadContextBindingInput,
		control?: McpWorkloadExecutionControl,
	) => unknown | Promise<unknown>;
	readonly audit?: (event: McpWorkloadAuditEvent) => void | Promise<void>;
	readonly executeHandoff?: (
		input: McpWorkloadHandoffInput,
	) => CallToolResult | Promise<CallToolResult>;
	readonly discoveryTools: WorkloadDiscoveryTool[];
}

function isProxy(value: unknown): boolean {
	return (
		!!value &&
		(typeof value === "object" || typeof value === "function") &&
		nodeTypes.isProxy(value)
	);
}

function readMethod<T extends (...args: never[]) => unknown>(
	owner: unknown,
	name: string,
): T | null {
	if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
		return null;
	}
	if (isProxy(owner)) return null;
	try {
		let candidate: object | null = owner;
		while (candidate) {
			if (isProxy(candidate)) return null;
			const descriptor = Object.getOwnPropertyDescriptor(candidate, name);
			if (descriptor) {
				if (
					!("value" in descriptor) ||
					typeof descriptor.value !== "function"
				) {
					return null;
				}
				return descriptor.value.bind(owner) as unknown as T;
			}
			candidate = Object.getPrototypeOf(candidate) as object | null;
		}
		return null;
	} catch {
		return null;
	}
}

export function createWorkloadMcpBoundary(
	options: WorkloadMcpServerOptions,
): WorkloadMcpBoundary {
	try {
		if (
			!options ||
			typeof options !== "object" ||
			isProxy(options) ||
			!("envelope" in options) ||
			options.envelope === undefined
		) {
			throw new Error(PUBLIC_ACCESS_DENIED);
		}
		const concurrencyKey =
			options.concurrencyKey === undefined
				? `boundary:${randomUUID()}`
				: typeof options.concurrencyKey === "string" &&
					  /^[\w.:-]{1,256}$/.test(options.concurrencyKey)
					? `consumer:${options.concurrencyKey}`
					: null;
		if (!concurrencyKey) throw new Error(PUBLIC_ACCESS_DENIED);
		const authorize = readMethod<
			(
				request: McpWorkloadAuthorizationRequest,
				control?: McpWorkloadExecutionControl,
			) => unknown | Promise<unknown>
		>(options.authorizer, "authorize");
		const bindContext = readMethod<
			(
				input: McpWorkloadContextBindingInput,
				control?: McpWorkloadExecutionControl,
			) => unknown | Promise<unknown>
		>(options.contextBinder, "bind");
		if (!authorize || !bindContext) throw new Error(PUBLIC_ACCESS_DENIED);
		let executeHandoff:
			| ((
					input: McpWorkloadHandoffInput,
			  ) => CallToolResult | Promise<CallToolResult>)
			| undefined;
		if (options.handoff) {
			const method = readMethod<
				(
					input: McpWorkloadHandoffInput,
				) => CallToolResult | Promise<CallToolResult>
			>(options.handoff, "execute");
			if (!method) throw new Error(PUBLIC_ACCESS_DENIED);
			executeHandoff = method;
		}
		return {
			envelope: options.envelope,
			concurrencyKey,
			authorize,
			bindContext,
			audit: options.audit,
			executeHandoff,
			discoveryTools: [],
		};
	} catch {
		throw new Error(PUBLIC_ACCESS_DENIED);
	}
}

function snapshotAuthorization(
	value: unknown,
): McpWorkloadAuthorization | null {
	try {
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			isProxy(value)
		) {
			return null;
		}
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const context = descriptors.context;
		const attribution = descriptors.attribution;
		if (!context || !("value" in context)) return null;
		if (attribution && !("value" in attribution)) return null;
		if (isProxy(context.value) || (attribution && isProxy(attribution.value))) {
			return null;
		}
		return Object.freeze({
			context: context.value,
			...(attribution ? { attribution: attribution.value } : {}),
		});
	} catch {
		return null;
	}
}

function isBoundContext(
	value: unknown,
): value is AppContext & Partial<RequestContext> {
	try {
		if (
			!value ||
			typeof value !== "object" ||
			Array.isArray(value) ||
			isProxy(value)
		) {
			return false;
		}
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const accessMode = descriptors.accessMode;
		const db = descriptors.db;
		const principal = descriptors.principal;
		return (
			!!accessMode &&
			"value" in accessMode &&
			accessMode.value === "user" &&
			!!db &&
			"value" in db &&
			!!db.value &&
			(!principal ||
				("value" in principal &&
					(principal.value as { kind?: unknown } | undefined)?.kind !==
						"system"))
		);
	} catch {
		return false;
	}
}

function normalizeRequirement(
	requirement: McpWorkloadRequirement | undefined,
): McpWorkloadRequirement | null {
	try {
		if (
			!requirement ||
			typeof requirement !== "object" ||
			isProxy(requirement) ||
			!Array.isArray(requirement.capabilities) ||
			requirement.capabilities.length === 0 ||
			requirement.capabilities.length > 64 ||
			requirement.capabilities.some((capability) => isProxy(capability)) ||
			!requirement.capabilities.every(
				(capability) =>
					typeof capability === "string" &&
					capability.length > 0 &&
					capability.length <= 256,
			) ||
			(requirement.handoff !== undefined &&
				(typeof requirement.handoff !== "string" ||
					requirement.handoff.length === 0 ||
					requirement.handoff.length > 256))
		) {
			return null;
		}
		return Object.freeze({
			capabilities: Object.freeze([...requirement.capabilities]),
			...(requirement.handoff ? { handoff: requirement.handoff } : {}),
		});
	} catch {
		return null;
	}
}

function normalizeTool(
	identity: WorkloadToolIdentity,
	requirement: McpWorkloadRequirement,
): McpWorkloadToolFacts {
	return Object.freeze({
		kind: identity.kind,
		name: identity.name,
		operation: identity.operation,
		intent: identity.intent,
		transport: "workload",
		capabilities: Object.freeze([...requirement.capabilities]),
		...(requirement.handoff ? { handoff: requirement.handoff } : {}),
	});
}

async function auditDecision(
	boundary: WorkloadMcpBoundary,
	event: McpWorkloadAuditEvent,
): Promise<void> {
	try {
		await boundary.audit?.(event);
	} catch {
		throw new Error(PUBLIC_ACCESS_DENIED);
	}
}

export async function authorizeWorkload(
	boundary: WorkloadMcpBoundary,
	phase: "discovery" | "call",
	identity: WorkloadToolIdentity,
	requirement: McpWorkloadRequirement | undefined,
	control?: McpWorkloadExecutionControl,
): Promise<AuthorizedWorkload | null> {
	const cancelled = () => control?.signal.aborted === true;
	if (cancelled()) return null;
	const normalized = normalizeRequirement(requirement);
	if (!normalized || (normalized.handoff && !boundary.executeHandoff)) {
		await auditDecision(boundary, {
			phase,
			decision: "denied",
			reason: "authorization_denied",
		});
		return null;
	}
	const tool = normalizeTool(identity, normalized);

	let result: unknown;
	try {
		result = await boundary.authorize(
			{
				phase,
				envelope: boundary.envelope,
				tool,
			},
			control,
		);
	} catch {
		result = null;
	}
	if (cancelled()) return null;
	const authorization = snapshotAuthorization(result);
	if (!authorization) {
		await auditDecision(boundary, {
			phase,
			decision: "denied",
			reason: "authorization_invalid",
		});
		return null;
	}

	if (cancelled()) return null;
	let context: unknown;
	try {
		context = await boundary.bindContext(
			{
				authorizationContext: authorization.context,
				attribution: authorization.attribution,
				tool,
			},
			control,
		);
	} catch {
		context = null;
	}
	if (cancelled()) return null;
	if (!isBoundContext(context)) {
		await auditDecision(boundary, {
			phase,
			decision: "denied",
			reason: "context_invalid",
		});
		return null;
	}

	if (cancelled()) return null;
	await auditDecision(boundary, {
		phase,
		decision: "allowed",
		toolName: tool.name,
		attribution: authorization.attribution,
	});
	if (cancelled()) return null;
	return Object.freeze({
		authorization,
		concurrencyKey: boundary.concurrencyKey,
		context,
		tool,
	});
}

export function registerWorkloadDiscoveryTool(
	boundary: WorkloadMcpBoundary,
	tool: Tool,
	identity: WorkloadToolIdentity,
	requirement: McpWorkloadRequirement | undefined,
	allows: WorkloadDiscoveryTool["allows"],
): void {
	const normalized = normalizeRequirement(requirement);
	if (!normalized) return;
	boundary.discoveryTools.push({
		tool: Object.freeze({ ...tool }),
		identity: Object.freeze({ ...identity }),
		requirement: normalized,
		allows,
	});
}

export async function listWorkloadTools(
	boundary: WorkloadMcpBoundary,
	execution: McpExecutionBoundary,
	extra: McpHandlerExtra,
): Promise<ListToolsResult> {
	const tools: Tool[] = [];
	const controller = new AbortController();
	let timedOut = false;
	const cancel = () => controller.abort(extra.signal.reason);
	if (extra.signal.aborted) cancel();
	else extra.signal.addEventListener("abort", cancel, { once: true });
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort(new Error("MCP discovery deadline exceeded"));
	}, execution.limits.timeoutMs);
	const boundedExtra = { ...extra, signal: controller.signal };

	try {
		for (const candidate of boundary.discoveryTools) {
			try {
				let workloadAuthorization: AuthorizedWorkload | null | undefined;
				const tool = await execution.execute({
					operation: "tools/list",
					transport: "workload",
					accessMode: "user",
					input: { name: candidate.tool.name },
					extra: boundedExtra,
					authorize: async (control) => {
						workloadAuthorization = await authorizeWorkload(
							boundary,
							"discovery",
							candidate.identity,
							candidate.requirement,
							control,
						);
						if (
							!workloadAuthorization ||
							!(await candidate.allows(workloadAuthorization.context))
						) {
							throw new McpAccessDeniedError();
						}
						return workloadAuthorization.context;
					},
					concurrencyKey: () => workloadAuthorization?.concurrencyKey,
					invoke: async () => candidate.tool,
				});
				tools.push(tool);
			} catch (error) {
				const code = mcpPublicErrorCode(error);
				if (code === "access_denied" || code === "internal") continue;
				if (timedOut && code === "cancelled") {
					throw new McpPublicError("timeout");
				}
				throw error;
			}
		}
		assertBoundedMcpValue(
			{ tools },
			{
				maxBytes: execution.limits.maxOutputBytes,
				maxValueDepth: execution.limits.maxOutputDepth,
				maxValueNodes: execution.limits.maxValueNodes,
			},
			"output_too_large",
		);
		return { tools };
	} finally {
		clearTimeout(timer);
		extra.signal.removeEventListener("abort", cancel);
	}
}

export async function executeWorkloadTool(
	boundary: WorkloadMcpBoundary,
	authorized: AuthorizedWorkload,
	metadata: unknown,
	execution: {
		signal: AbortSignal;
		requestId: string | number;
		correlationId: string;
	},
	invoke: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
	if (!authorized.tool.handoff) return invoke();
	if (!boundary.executeHandoff) throw new Error(PUBLIC_ACCESS_DENIED);
	try {
		return await boundary.executeHandoff({
			authorizationContext: authorized.authorization.context,
			attribution: authorized.authorization.attribution,
			toolName: authorized.tool.name,
			capability: authorized.tool.handoff,
			tool: authorized.tool,
			metadata,
			signal: execution.signal,
			requestId: execution.requestId,
			correlationId: execution.correlationId,
			invoke,
		});
	} catch {
		throw new Error(PUBLIC_ACCESS_DENIED);
	}
}
