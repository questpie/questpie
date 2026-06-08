import { ApiError } from "questpie/errors";
import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

import {
	artifactContentPayload,
	legacyArtifactFromResource,
	legacyArtifactRefKinds,
} from "../lib/legacy-run-artifacts";
import {
	createRunArtifactForMcp,
	mcpJson,
	parseJsonObject,
	requireMcpCaller,
} from "../lib/mcp-tool-helpers";

const refKindSchema = z.enum(legacyArtifactRefKinds);

const runArtifactsSchema = z.object({
	run_id: z.string().min(1).describe("Run id"),
});

const runArtifactContentSchema = z.object({
	run_id: z.string().min(1).describe("Run id"),
	artifact_id: z.string().min(1).describe("Artifact id"),
});

const runArtifactCreateSchema = z.object({
	run_id: z.string().min(1).describe("Run id"),
	title: z.string().min(1).describe("Artifact title or filename"),
	content: z.string().describe("Artifact content, URL, file path, or base64"),
	kind: z.string().optional().describe("Artifact kind"),
	ref_kind: refKindSchema.optional().describe("Reference kind"),
	mime_type: z.string().optional().describe("MIME type"),
	metadata: z.string().optional().describe("Metadata JSON object"),
});

const artifactCreateSchema = z.object({
	run_id: z
		.string()
		.optional()
		.describe("Run id; falls back to AUTOPILOT_RUN_ID"),
	title: z.string().min(1).describe("Human-readable artifact title"),
	content: z.string().describe("Artifact content"),
	type: z.enum(["html", "code", "document", "image", "file"]),
	filename: z.string().optional().describe("Filename"),
	language: z.string().optional().describe("Programming language for code"),
});

function slugify(value: string, type: string) {
	const ext =
		type === "html"
			? "html"
			: type === "document"
				? "md"
				: type === "image"
					? "svg"
					: type === "code"
						? "txt"
						: "bin";
	const slug =
		value
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "artifact";
	return slug.includes(".") ? slug : `${slug}.${ext}`;
}

function artifactTypeMeta(type: z.infer<typeof artifactCreateSchema>["type"]) {
	switch (type) {
		case "html":
			return { kind: "preview_file", mime_type: "text/html" };
		case "document":
			return { kind: "doc", mime_type: "text/markdown" };
		case "image":
			return { kind: "other", mime_type: "image/svg+xml" };
		case "code":
			return { kind: "other", mime_type: "text/plain" };
		default:
			return { kind: "other", mime_type: "application/octet-stream" };
	}
}

export const runArtifacts = mcpTool("run_artifacts", {
	title: "List run artifacts",
	description: "List artifacts produced by a run.",
	inputSchema: runArtifactsSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const resources = await ctx.collections.assets.find({
		where: { run: input.run_id },
		limit: 500,
		orderBy: { createdAt: "asc" },
	});
	return mcpJson(resources.docs.map(legacyArtifactFromResource));
});

export const runArtifactContent = mcpTool("run_artifact_content", {
	title: "Read run artifact content",
	description: "Read resolved artifact content.",
	inputSchema: runArtifactContentSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx, request, accessMode }) => {
	await requireMcpCaller({ ctx, request, accessMode });

	const resource = await ctx.collections.assets.findOne({
		where: { id: input.artifact_id, run: input.run_id },
	});
	if (!resource) throw ApiError.notFound("Artifact", input.artifact_id);

	return mcpJson(await artifactContentPayload(resource));
});

export const runArtifactCreate = mcpTool("run_artifact_create", {
	title: "Create run artifact",
	description: "Create an artifact on a specific active run.",
	inputSchema: runArtifactCreateSchema,
}).handler(async ({ input, ctx, request, accessMode }) => {
	const result = await createRunArtifactForMcp({
		ctx,
		request,
		accessMode,
		runId: input.run_id,
		artifact: {
			title: input.title,
			content: input.content,
			kind: input.kind ?? "other",
			ref_kind: input.ref_kind ?? "inline",
			mime_type: input.mime_type,
			metadata: parseJsonObject(input.metadata),
		},
	});

	return mcpJson({
		id: result.id,
		preview_url: result.preview_url,
		artifact: legacyArtifactFromResource(result.resource),
	});
});

export const artifactCreate = mcpTool("artifact_create", {
	title: "Create preview artifact",
	description:
		"Create a previewable artifact for the active run. Prefer self-contained HTML for visual output.",
	inputSchema: artifactCreateSchema,
}).handler(async ({ input, ctx, request, accessMode }) => {
	const runId = input.run_id ?? process.env.AUTOPILOT_RUN_ID;
	if (!runId) {
		throw ApiError.badRequest(
			"run_id is required when AUTOPILOT_RUN_ID is not set",
		);
	}

	const meta = artifactTypeMeta(input.type);
	const filename = input.filename ?? slugify(input.title, input.type);
	const result = await createRunArtifactForMcp({
		ctx,
		request,
		accessMode,
		runId,
		artifact: {
			title: filename,
			content: input.content,
			kind: meta.kind,
			ref_kind: "inline",
			mime_type: meta.mime_type,
			metadata: {
				artifact_type: input.type,
				language: input.language,
				original_title: input.title,
			},
		},
	});

	return mcpJson({
		id: result.id,
		preview_url: result.preview_url,
		artifact: legacyArtifactFromResource(result.resource),
	});
});
