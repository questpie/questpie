import { createHash } from "node:crypto";
import { basename, posix } from "node:path";

import { ApiError } from "questpie/errors";
import { service } from "questpie/services";

type Collections = Questpie.AppContext["collections"];

export type KnowledgeScopeType = "company" | "project" | "task";
export type KnowledgeKind =
	| "document"
	| "upload"
	| "artifact"
	| "result"
	| "summary"
	| "preview"
	| "log"
	| "diff";
export type KnowledgeSource =
	| "human"
	| "assistant"
	| "worker"
	| "mcp"
	| "import"
	| "system";

export interface CreateTextResourceInput {
	title?: string | null;
	path: string;
	body: string;
	scopeType?: KnowledgeScopeType | null;
	projectId?: string | null;
	taskId?: string | null;
	runId?: string | null;
	kind?: KnowledgeKind | null;
	contentType?: string | null;
	renderer?: string | null;
	source?: KnowledgeSource | null;
	sourceRef?: string | null;
	metadata?: Record<string, unknown> | null;
}

export interface WorkerArtifactInput {
	title?: string | null;
	path?: string | null;
	kind?: string | null;
	body?: string | null;
	content?: string | null;
	contentType?: string | null;
	mimeType?: string | null;
	renderer?: string | null;
	refKind?: string | null;
	refValue?: string | null;
	metadata?: Record<string, unknown> | null;
	source?: KnowledgeSource | null;
}

export interface CreateRunOutputInput {
	runId: string;
	summary?: string | null;
	outputs?: unknown;
	artifacts?: WorkerArtifactInput[];
	source?: KnowledgeSource;
}

export function normalizeKnowledgePath(path: string): string {
	const trimmed = path.trim().replace(/^\/+/, "");
	const normalized = posix.normalize(trimmed);
	if (
		!normalized ||
		normalized === "." ||
		normalized.startsWith("../") ||
		normalized.includes("/../")
	) {
		throw ApiError.badRequest(`Invalid knowledge path: ${path}`);
	}
	return normalized;
}

export function hashContent(content: string | Uint8Array): string {
	return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function inferContentType(path: string): string {
	const lower = path.toLowerCase();
	if (lower.endsWith(".md") || lower.endsWith(".markdown"))
		return "text/markdown";
	if (lower.endsWith(".json")) return "application/json";
	if (lower.endsWith(".yaml") || lower.endsWith(".yml"))
		return "application/yaml";
	if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
	if (lower.endsWith(".diff") || lower.endsWith(".patch")) return "text/x-diff";
	return "text/plain";
}

function stableSegment(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120);
}

function normalizeArtifactKind(kind: string | null | undefined): KnowledgeKind {
	switch (kind) {
		case "result":
		case "summary":
		case "preview":
		case "log":
		case "diff":
			return kind;
		case "changed_file":
			return "diff";
		case "preview_file":
		case "preview_url":
			return "preview";
		default:
			return "artifact";
	}
}

async function resolveRunScope(collections: Collections, runId: string) {
	const run = await collections.run_links.findOne({
		where: { id: runId },
		with: { task: true, project: true },
	});
	if (!run) throw ApiError.notFound("Run", runId);

	return {
		taskId:
			typeof run.task === "string"
				? run.task
				: run.task && typeof run.task === "object" && "id" in run.task
					? String(run.task.id)
					: null,
		projectId:
			typeof run.project === "string"
				? run.project
				: run.project && typeof run.project === "object" && "id" in run.project
					? String(run.project.id)
					: null,
	};
}

function validateScope(input: CreateTextResourceInput) {
	const scopeType =
		input.scopeType ??
		(input.taskId ? "task" : input.projectId ? "project" : "company");
	if (scopeType === "project" && !input.projectId) {
		throw ApiError.badRequest("Project-scoped knowledge requires projectId");
	}
	if (scopeType === "task" && !input.taskId) {
		throw ApiError.badRequest("Task-scoped knowledge requires taskId");
	}
	return scopeType;
}

export default service({
	lifecycle: "singleton",
	create: ({ collections }) => {
		const api = {
			normalizePath: normalizeKnowledgePath,
			hashContent,

			async createTextResource(input: CreateTextResourceInput) {
				const path = normalizeKnowledgePath(input.path);
				const scopeType = validateScope(input);
				const contentHash = hashContent(input.body);

				return collections.knowledge.create({
					title: input.title ?? basename(path),
					path,
					scopeType,
					project: input.projectId ?? undefined,
					task: input.taskId ?? undefined,
					run: input.runId ?? undefined,
					kind: input.kind ?? "document",
					contentType: input.contentType ?? inferContentType(path),
					body: input.body,
					renderer: input.renderer ?? undefined,
					source: input.source ?? "system",
					sourceRef: input.sourceRef ?? undefined,
					contentHash,
					metadata: (input.metadata ?? undefined) as any,
				} as any);
			},

			async createRunArtifact(runId: string, artifact: WorkerArtifactInput) {
				const scope = await resolveRunScope(collections, runId);
				const title = artifact.title ?? artifact.path ?? "Artifact";
				const body =
					artifact.body ??
					artifact.content ??
					(artifact.refValue
						? JSON.stringify(
								{
									refKind: artifact.refKind ?? "external",
									refValue: artifact.refValue,
								},
								null,
								2,
							)
						: "");
				const kind = normalizeArtifactKind(artifact.kind);
				const path =
					artifact.path ??
					`runs/${runId}/artifacts/${stableSegment(title) || "artifact"}.md`;

				return api.createTextResource({
					title,
					path,
					body,
					scopeType: scope.taskId
						? "task"
						: scope.projectId
							? "project"
							: "company",
					projectId: scope.projectId,
					taskId: scope.taskId,
					runId,
					kind,
					contentType:
						artifact.contentType ?? artifact.mimeType ?? inferContentType(path),
					renderer: artifact.renderer,
					source: artifact.source ?? "worker",
					sourceRef: runId,
					metadata: {
						...(artifact.metadata ?? {}),
						artifactKind: artifact.kind ?? null,
						refKind: artifact.refKind ?? null,
						refValue: artifact.refValue ?? null,
					},
				});
			},

			async createRunOutputs(input: CreateRunOutputInput) {
				const scope = await resolveRunScope(collections, input.runId);
				const resources = [];

				if (input.summary?.trim()) {
					resources.push(
						await api.createTextResource({
							title: "Run summary",
							path: `runs/${input.runId}/summary.md`,
							body: input.summary,
							scopeType: scope.taskId
								? "task"
								: scope.projectId
									? "project"
									: "company",
							projectId: scope.projectId,
							taskId: scope.taskId,
							runId: input.runId,
							kind: "summary",
							contentType: "text/markdown",
							source: input.source ?? "worker",
							sourceRef: input.runId,
						}),
					);
				}

				if (input.outputs !== undefined && input.outputs !== null) {
					resources.push(
						await api.createTextResource({
							title: "Run result",
							path: `runs/${input.runId}/result.json`,
							body: JSON.stringify(input.outputs, null, 2),
							scopeType: scope.taskId
								? "task"
								: scope.projectId
									? "project"
									: "company",
							projectId: scope.projectId,
							taskId: scope.taskId,
							runId: input.runId,
							kind: "result",
							contentType: "application/json",
							renderer: "json",
							source: input.source ?? "worker",
							sourceRef: input.runId,
						}),
					);
				}

				for (const artifact of input.artifacts ?? []) {
					resources.push(await api.createRunArtifact(input.runId, artifact));
				}

				return resources;
			},
		};
		return api;
	},
});
