import { ApiError } from "questpie/errors";

import type { McpAccessMode } from "@questpie/mcp";

import {
	activeRunStatus,
	artifactContentUrl,
	normalizeLegacyArtifact,
	type LegacyArtifactInput,
} from "./legacy-run-artifacts";
import { asRecord, relationId } from "./records";

export type McpCaller =
	| { kind: "system"; actorId: "system" }
	| { kind: "session"; actorId: string };

function sessionUserId(session: unknown) {
	if (!session || typeof session !== "object" || !("user" in session)) {
		return null;
	}
	const user = (session as { user?: unknown }).user;
	if (!user || typeof user !== "object" || !("id" in user)) return null;
	const id = (user as { id?: unknown }).id;
	return typeof id === "string" && id.trim() ? id : null;
}

export function mcpJson(value: unknown) {
	const structuredContent =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: { value };

	return {
		structuredContent,
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
	};
}

export function parseJsonObject(value: string | null | undefined) {
	if (!value) return undefined;
	const parsed = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw ApiError.badRequest("Expected a JSON object");
	}
	return parsed as Record<string, unknown>;
}

export async function requireMcpCaller(input: {
	ctx: Questpie.AppContext & { session?: unknown };
	request?: Request;
	accessMode: McpAccessMode;
}): Promise<McpCaller> {
	if (input.accessMode === "system") {
		return { kind: "system" as const, actorId: "system" as const };
	}
	const actorId = sessionUserId(input.ctx.session);
	if (actorId) return { kind: "session" as const, actorId };
	throw ApiError.unauthorized("MCP authentication required");
}

export async function writableRunForMcp(input: {
	ctx: Questpie.AppContext & { session?: unknown };
	request?: Request;
	accessMode: McpAccessMode;
	runId: string;
}) {
	const caller = await requireMcpCaller(input);
	const run = await input.ctx.collections.run_links.findOne({
		where: { id: input.runId },
	});
	if (!run) throw ApiError.notFound("Run", input.runId);
	if (!activeRunStatus(run.status)) {
		throw ApiError.badRequest(
			`run ${input.runId} is ${String(
				run.status,
			)} - cannot add artifacts to a terminal run`,
		);
	}
	return { run, worker: null, caller };
}

export function knowledgeScope(input: {
	scope_type?: "company" | "project" | "task";
	scope_id?: string;
	project_id?: string;
	task_id?: string;
}) {
	const scopeType =
		input.scope_type ??
		(input.task_id
			? "task"
			: input.project_id
				? "project"
				: ("company" as const));

	const projectId =
		input.project_id ?? (scopeType === "project" ? input.scope_id : undefined);
	const taskId =
		input.task_id ?? (scopeType === "task" ? input.scope_id : undefined);

	return { scopeType, projectId, taskId };
}

export function knowledgeWhere(input: {
	path?: string;
	scope_type?: "company" | "project" | "task";
	scope_id?: string;
	project_id?: string;
	task_id?: string;
	query?: string;
}) {
	const scope = knowledgeScope(input);
	const where: Record<string, unknown> = {};
	if (input.path) where.path = input.path;
	if (scope.scopeType) where.scopeType = scope.scopeType;
	if (scope.projectId) where.project = scope.projectId;
	if (scope.taskId) where.task = scope.taskId;
	if (input.query) {
		where.OR = [
			{ title: { contains: input.query } },
			{ path: { contains: input.query } },
			{ body: { contains: input.query } },
		];
	}
	return where;
}

export async function createRunArtifactForMcp(input: {
	ctx: Questpie.AppContext & { session?: unknown };
	request?: Request;
	accessMode: McpAccessMode;
	runId: string;
	artifact: LegacyArtifactInput;
}) {
	const { caller } = await writableRunForMcp(input);
	const resource = await input.ctx.services.knowledgeResource.createRunArtifact(
		input.runId,
		normalizeLegacyArtifact({
			...input.artifact,
			metadata: {
				...(input.artifact.metadata ?? {}),
				mcpActorId: caller.actorId,
				mcpCallerKind: caller.kind,
			},
			source: "mcp",
		}),
	);
	return {
		id: resource.id,
		artifact_id: resource.id,
		knowledge_resource_id: resource.id,
		preview_url: artifactContentUrl(input.runId, resource.id),
		resource,
	};
}

export function relationValueId(value: unknown) {
	return relationId(value);
}

export function recordMetadata(value: unknown) {
	return asRecord(value);
}
