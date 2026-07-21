import type {
	CallToolResult,
	ListToolsResult,
	Tool,
} from "@modelcontextprotocol/sdk/types.js";

import {
	AgentWorkloadAuthorityError,
	allowsExactScopedGrant,
	type AgentWorkloadPrincipal,
} from "@questpie/ai";

import type {
	AgentWorkloadMcpServerOptions,
	McpAgentWorkloadRequirement,
} from "./types.js";

const PUBLIC_ACCESS_DENIED = "MCP access denied";

export const AGENT_WORKLOAD_MCP_META = Object.freeze({
	commandId: "io.questpie/command-id",
	idempotencyKey: "io.questpie/idempotency-key",
	effectRequestId: "io.questpie/effect-request-id",
} as const);

export interface AgentWorkloadMcpBoundary {
	readonly envelope: AgentWorkloadMcpServerOptions["envelope"];
	readonly resolver: AgentWorkloadMcpServerOptions["resolver"];
	readonly discoveryPrincipal: AgentWorkloadPrincipal;
	readonly audit?: AgentWorkloadMcpServerOptions["audit"];
	readonly effectHandoff?: AgentWorkloadMcpServerOptions["effectHandoff"];
	readonly discoveryTools: Tool[];
}

export async function createAgentWorkloadMcpBoundary(
	options: AgentWorkloadMcpServerOptions,
): Promise<AgentWorkloadMcpBoundary> {
	if (
		!options ||
		typeof options !== "object" ||
		!options.envelope ||
		!options.resolver ||
		typeof options.resolver.validate !== "function"
	) {
		throw new AgentWorkloadAuthorityError("invalid_principal");
	}
	return {
		envelope: options.envelope,
		resolver: options.resolver,
		discoveryPrincipal: await options.resolver.validate(options.envelope),
		audit: options.audit,
		effectHandoff: options.effectHandoff,
		discoveryTools: [],
	};
}

function requirementFor(
	principal: AgentWorkloadPrincipal,
	requirement: McpAgentWorkloadRequirement,
) {
	return requirement.scope === "company"
		? {
				scope: "company" as const,
				companyId: principal.scope.companyId,
				grant: requirement.grant,
			}
		: {
				scope: "anchor_space" as const,
				companyId: principal.scope.companyId,
				anchorSpaceId: principal.scope.anchorSpaceId,
				grant: requirement.grant,
			};
}

function permits(
	principal: AgentWorkloadPrincipal,
	toolName: string,
	requirement: McpAgentWorkloadRequirement | undefined,
): boolean {
	if (!requirement || !principal.capabilities.tools.includes(toolName)) {
		return false;
	}
	if (
		requirement.effect !== false &&
		!principal.capabilities.effects.includes(requirement.effect)
	) {
		return false;
	}
	return allowsExactScopedGrant(
		principal,
		requirementFor(principal, requirement),
	);
}

async function auditDecision(
	boundary: AgentWorkloadMcpBoundary,
	principal: AgentWorkloadPrincipal,
	event: {
		phase: "discovery" | "call";
		decision: "allowed" | "denied";
		toolName?: string;
		reason?: "authority_not_current" | "capability_denied";
	},
): Promise<void> {
	try {
		await boundary.audit?.({
			...event,
			principalId: principal.principalId,
			runId: principal.run.id,
			attemptId: principal.run.attemptId,
			agentActorId: principal.attribution.agentActorId,
		});
	} catch {
		throw new Error(PUBLIC_ACCESS_DENIED);
	}
}

export async function isAgentWorkloadDiscoveryCurrent(
	boundary: AgentWorkloadMcpBoundary,
): Promise<boolean> {
	try {
		await boundary.resolver.validate(boundary.envelope);
		return true;
	} catch {
		try {
			await auditDecision(boundary, boundary.discoveryPrincipal, {
				phase: "discovery",
				decision: "denied",
				reason: "authority_not_current",
			});
		} catch {
			// Discovery stays empty even when its diagnostic sink is unavailable.
		}
		return false;
	}
}

export function registerAgentWorkloadDiscoveryTool(
	boundary: AgentWorkloadMcpBoundary,
	tool: Tool,
): void {
	boundary.discoveryTools.push(Object.freeze({ ...tool }));
}

export async function listAgentWorkloadTools(
	boundary: AgentWorkloadMcpBoundary,
): Promise<ListToolsResult> {
	if (!(await isAgentWorkloadDiscoveryCurrent(boundary))) {
		return { tools: [] };
	}
	return { tools: [...boundary.discoveryTools] };
}

export async function permitsAgentWorkloadDiscovery(
	boundary: AgentWorkloadMcpBoundary,
	toolName: string,
	requirement: McpAgentWorkloadRequirement | undefined,
): Promise<boolean> {
	const allowed =
		permits(boundary.discoveryPrincipal, toolName, requirement) &&
		(requirement?.effect === false || !!boundary.effectHandoff);
	await auditDecision(boundary, boundary.discoveryPrincipal, {
		phase: "discovery",
		decision: allowed ? "allowed" : "denied",
		toolName: allowed ? toolName : undefined,
		reason: allowed ? undefined : "capability_denied",
	});
	return allowed;
}

export async function authorizeAgentWorkloadCall(
	boundary: AgentWorkloadMcpBoundary,
	toolName: string,
	requirement: McpAgentWorkloadRequirement | undefined,
): Promise<AgentWorkloadPrincipal | null> {
	let principal: AgentWorkloadPrincipal;
	try {
		principal = await boundary.resolver.validate(boundary.envelope);
	} catch {
		await auditDecision(boundary, boundary.discoveryPrincipal, {
			phase: "call",
			decision: "denied",
			toolName,
			reason: "authority_not_current",
		});
		return null;
	}
	const allowed = permits(principal, toolName, requirement);
	await auditDecision(boundary, principal, {
		phase: "call",
		decision: allowed ? "allowed" : "denied",
		toolName: allowed ? toolName : undefined,
		reason: allowed ? undefined : "capability_denied",
	});
	return allowed ? principal : null;
}

function readCommandMetadata(meta: unknown) {
	if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
	const record = meta as Record<string, unknown>;
	const commandId = record[AGENT_WORKLOAD_MCP_META.commandId];
	const idempotencyKey = record[AGENT_WORKLOAD_MCP_META.idempotencyKey];
	const effectRequestId = record[AGENT_WORKLOAD_MCP_META.effectRequestId];
	if (
		![commandId, idempotencyKey, effectRequestId].every(
			(value) =>
				typeof value === "string" && value.length > 0 && value.length <= 256,
		)
	) {
		return null;
	}
	return {
		commandId: commandId as string,
		idempotencyKey: idempotencyKey as string,
		effectRequestId: effectRequestId as string,
	};
}

export async function executeAgentWorkloadTool(
	boundary: AgentWorkloadMcpBoundary,
	principal: AgentWorkloadPrincipal,
	toolName: string,
	requirement: McpAgentWorkloadRequirement,
	meta: unknown,
	invoke: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
	if (requirement.effect === false) return invoke();
	const command = readCommandMetadata(meta);
	if (!command || !boundary.effectHandoff) {
		throw new Error("MCP access denied");
	}
	return boundary.effectHandoff.execute({
		principal,
		toolName,
		effect: requirement.effect,
		command,
		invoke,
	});
}
