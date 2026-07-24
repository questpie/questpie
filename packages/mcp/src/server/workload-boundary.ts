import { types as nodeTypes } from "node:util";

import type {
	CallToolResult,
	ListToolsResult,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { AppContext, RequestContext } from "questpie";

import type {
	McpWorkloadAuthorization,
	McpWorkloadAuthorizationRequest,
	McpWorkloadAuditEvent,
	McpWorkloadContextBindingInput,
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
	readonly context: AppContext & Partial<RequestContext>;
	readonly tool: McpWorkloadToolFacts;
}

export interface WorkloadMcpBoundary {
	readonly envelope: unknown;
	readonly authorize: (
		request: McpWorkloadAuthorizationRequest,
	) => unknown | Promise<unknown>;
	readonly bindContext: (
		input: McpWorkloadContextBindingInput,
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
		const authorize = readMethod<
			(request: McpWorkloadAuthorizationRequest) => unknown | Promise<unknown>
		>(options.authorizer, "authorize");
		const bindContext = readMethod<
			(input: McpWorkloadContextBindingInput) => unknown | Promise<unknown>
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
): Promise<AuthorizedWorkload | null> {
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
		result = await boundary.authorize({
			phase,
			envelope: boundary.envelope,
			tool,
		});
	} catch {
		result = null;
	}
	const authorization = snapshotAuthorization(result);
	if (!authorization) {
		await auditDecision(boundary, {
			phase,
			decision: "denied",
			reason: "authorization_invalid",
		});
		return null;
	}

	let context: unknown;
	try {
		context = await boundary.bindContext({
			authorizationContext: authorization.context,
			attribution: authorization.attribution,
			tool,
		});
	} catch {
		context = null;
	}
	if (!isBoundContext(context)) {
		await auditDecision(boundary, {
			phase,
			decision: "denied",
			reason: "context_invalid",
		});
		return null;
	}

	await auditDecision(boundary, {
		phase,
		decision: "allowed",
		toolName: tool.name,
		attribution: authorization.attribution,
	});
	return Object.freeze({ authorization, context, tool });
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
): Promise<ListToolsResult> {
	const tools: Tool[] = [];
	for (const candidate of boundary.discoveryTools) {
		try {
			const authorized = await authorizeWorkload(
				boundary,
				"discovery",
				candidate.identity,
				candidate.requirement,
			);
			if (authorized && (await candidate.allows(authorized.context))) {
				tools.push(candidate.tool);
			}
		} catch {
			// Discovery remains empty for this tool when authority or access fails.
		}
	}
	return { tools };
}

export async function executeWorkloadTool(
	boundary: WorkloadMcpBoundary,
	authorized: AuthorizedWorkload,
	metadata: unknown,
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
			invoke,
		});
	} catch {
		throw new Error(PUBLIC_ACCESS_DENIED);
	}
}
