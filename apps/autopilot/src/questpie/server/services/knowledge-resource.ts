import { createHash } from "node:crypto";
import { basename, posix } from "node:path";

import { ApiError } from "questpie/errors";
import { service } from "questpie/services";

import type { AppCollections } from "../lib/app-types";

type Collections = AppCollections;

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

/** A knowledge resource read back by path (format-agnostic file-as-DB read). */
export interface KnowledgeResourceRecord {
	id: string;
	path: string;
	title: string | null;
	body: string;
	contentType: string | null;
	metadata: Record<string, unknown> | null;
}

/**
 * A created/updated `assets` row as returned by the create helpers. Typed
 * explicitly (`id` + open record) because the unified `assets` collection's
 * generated row type collapses to `{}` for consumers — `assets` is defined by
 * BOTH the admin module and this app, and codegen intersects the two
 * (`_ModuleCollections["assets"] & typeof _coll_assets`), which erases field
 * inference. Annotating the service return restores `.id` (and the row) for the
 * artifact/MCP callers without each one re-casting the collapsed result.
 */
export type KnowledgeRowResult = { id: string } & Record<string, unknown>;

/** Single entry returned by a by-prefix listing. */
export interface KnowledgeResourceEntry {
	path: string;
	title: string | null;
	contentType: string | null;
}

export interface WriteResourceByPathInput {
	path: string;
	body: string;
	title?: string | null;
	contentType?: string | null;
	scopeType?: KnowledgeScopeType | null;
	projectId?: string | null;
	taskId?: string | null;
	runId?: string | null;
	kind?: KnowledgeKind | null;
	source?: KnowledgeSource | null;
	sourceRef?: string | null;
	metadata?: Record<string, unknown> | null;
}

/**
 * Optional access context for the by-path file-as-DB primitives
 * ({@link readByPath}/{@link writeByPath}/{@link listByPrefix}).
 *
 * These primitives are the storage layer for callers that have ALREADY imposed
 * their own host-side path authorization (the mini-app bindings clamp every path
 * to the app's own subtree BEFORE calling — see
 * `apps/mini-app-bindings.ts` G1). Such a caller passes `accessMode:"system"` so
 * the `assets` collection's per-row visibility read rule does NOT additionally
 * gate the already-clamped own-data access.
 *
 * Omitting it (the default) preserves the previous behavior exactly: the
 * underlying `collections.assets.*` calls inherit `accessMode`/`session` from
 * the surrounding `runWithContext` (ALS) scope. A `system` mode is ONLY ever
 * sound when the caller has independently authorized the exact path.
 *
 * Structurally a partial CRUD/request context (all fields optional, extra keys
 * allowed) so it threads straight into `collections.assets.*`; in practice
 * only `accessMode` is set here.
 */
export interface KnowledgeByPathContext {
	accessMode?: "user" | "system";
	[key: string]: unknown;
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

			async createTextResource(
				input: CreateTextResourceInput,
			): Promise<KnowledgeRowResult> {
				const path = normalizeKnowledgePath(input.path);
				const scopeType = validateScope(input);
				const contentHash = hashContent(input.body);

				return (await collections.assets.create({
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
				} as any)) as KnowledgeRowResult;
			},

			/**
			 * Read a single knowledge resource by its exact (normalized) path.
			 * Format-agnostic: returns the stored bytes-as-text plus content-type
			 * and metadata; the caller decides how to interpret them.
			 */
			async readByPath(
				rawPath: string,
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceRecord | null> {
				const path = normalizeKnowledgePath(rawPath);
				const resource = await collections.assets.findOne(
					{ where: { path } },
					context,
				);
				if (!resource) return null;
				const row = resource as Record<string, unknown>;
				return {
					id: String(row.id),
					path: typeof row.path === "string" ? row.path : path,
					title: typeof row.title === "string" ? row.title : null,
					body: typeof row.body === "string" ? row.body : "",
					contentType:
						typeof row.contentType === "string" ? row.contentType : null,
					metadata:
						row.metadata && typeof row.metadata === "object"
							? (row.metadata as Record<string, unknown>)
							: null,
				};
			},

			/**
			 * Create-or-overwrite a knowledge resource at an exact path
			 * (upsert by path). Content-agnostic: `body`/`contentType` are stored
			 * verbatim — no format parsing.
			 */
			async writeByPath(
				input: WriteResourceByPathInput,
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceRecord> {
				const path = normalizeKnowledgePath(input.path);
				const contentHash = hashContent(input.body);
				const existing = await collections.assets.findOne(
					{ where: { path } },
					context,
				);

				const data = {
					title: input.title ?? basename(path),
					path,
					scopeType: input.scopeType ?? "company",
					project: input.projectId ?? undefined,
					task: input.taskId ?? undefined,
					run: input.runId ?? undefined,
					kind: input.kind ?? "document",
					contentType: input.contentType ?? inferContentType(path),
					body: input.body,
					source: input.source ?? "system",
					sourceRef: input.sourceRef ?? undefined,
					contentHash,
					metadata: (input.metadata ?? undefined) as any,
				};

				const saved = existing
					? await collections.assets.updateById(
							{
								id: (existing as Record<string, unknown>).id as string,
								data: data as any,
							},
							context,
						)
					: await collections.assets.create(data as any, context);

				const row = saved as Record<string, unknown>;
				return {
					id: String(row.id),
					path: typeof row.path === "string" ? row.path : path,
					title: typeof row.title === "string" ? row.title : null,
					body: typeof row.body === "string" ? row.body : input.body,
					contentType:
						typeof row.contentType === "string"
							? row.contentType
							: (data.contentType ?? null),
					metadata:
						row.metadata && typeof row.metadata === "object"
							? (row.metadata as Record<string, unknown>)
							: ((input.metadata ?? null) as Record<string, unknown> | null),
				};
			},

			/**
			 * List knowledge resources whose path starts with `prefix`
			 * (already normalized by the caller). Returns lightweight entries
			 * (no bodies) ordered by path.
			 */
			async listByPrefix(
				prefix: string,
				context?: KnowledgeByPathContext,
			): Promise<KnowledgeResourceEntry[]> {
				const result = await collections.assets.find(
					{
						where: { path: { startsWith: prefix } },
						limit: 1000,
						orderBy: { path: "asc" },
					},
					context,
				);
				const docs = (result as { docs?: unknown[] }).docs ?? [];
				return docs
					.map((doc) => doc as Record<string, unknown>)
					.filter((row) => typeof row.path === "string")
					.map((row) => ({
						path: row.path as string,
						title: typeof row.title === "string" ? row.title : null,
						contentType:
							typeof row.contentType === "string" ? row.contentType : null,
					}));
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
