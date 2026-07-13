import { ApiError } from "questpie/errors";
import { z } from "zod";

import {
	activeRunStatus,
	artifactContentUrl,
	legacyArtifactFromResource,
	legacyArtifactRefKinds,
	normalizeLegacyArtifact,
} from "../../../lib/legacy-run-artifacts";
import { sessionOnly } from "../../../lib/route-access";
import { workflowsFromContext } from "../../../lib/workflows";

const refKindSchema = z.enum(legacyArtifactRefKinds);

const artifactSchema = z
	.object({
		kind: z.string().default("preview_file"),
		title: z.string().min(1),
		path: z.string().optional(),
		ref_kind: refKindSchema.optional(),
		refKind: refKindSchema.optional(),
		ref_value: z.string().optional(),
		refValue: z.string().optional(),
		content: z.string().optional(),
		body: z.string().optional(),
		mime_type: z.string().optional(),
		mimeType: z.string().optional(),
		content_type: z.string().optional(),
		contentType: z.string().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.passthrough();

function json(data: unknown, init?: ResponseInit) {
	return new Response(JSON.stringify(data), {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
}

async function parseJson(request: Request) {
	const text = await request.text();
	return text ? JSON.parse(text) : {};
}

type ArtifactsContext = Questpie.AppContext & {
	request: Request;
	params: { runId: string };
};

function requestActor(ctx: ArtifactsContext) {
	if (ctx.session?.user?.id) return String(ctx.session.user.id);
	throw ApiError.unauthorized("Authentication required");
}

export { sessionOnly as artifactsAccess };
export type { ArtifactsContext };

export async function handleListArtifacts(ctx: ArtifactsContext) {
	requestActor(ctx);
	const resources = await ctx.collections.assets.find({
		where: { run: ctx.params.runId },
		limit: 500,
		orderBy: { createdAt: "asc" },
	});
	return json(resources.docs.map(legacyArtifactFromResource));
}

export async function handleCreateArtifact(ctx: ArtifactsContext) {
	const input = artifactSchema.parse(await parseJson(ctx.request));
	requestActor(ctx);
	const run = await ctx.collections.run_links.findOne({
		where: { id: ctx.params.runId },
	});
	if (!run) throw ApiError.notFound("Run", ctx.params.runId);

	if (!activeRunStatus(run.status)) {
		return json(
			{
				error: `run ${ctx.params.runId} is ${String(
					run.status,
				)} - cannot add artifacts to a terminal run`,
			},
			{ status: 409 },
		);
	}

	const resource = await ctx.services.knowledgeResource.createRunArtifact(
		ctx.params.runId,
		normalizeLegacyArtifact({ ...input, source: "worker" }),
	);
	const previewUrl = artifactContentUrl(ctx.params.runId, resource.id);

	await workflowsFromContext(ctx).sendEvent(
		"run.event",
		{
			runId: ctx.params.runId,
			type: "artifact",
			level: "info",
			summary: input.title,
			metadata: {
				artifactId: resource.id,
				knowledgeResourceId: resource.id,
				previewUrl,
			},
		},
		{ runId: ctx.params.runId },
	);

	return json(
		{
			id: resource.id,
			artifact_id: resource.id,
			knowledge_resource_id: resource.id,
			preview_url: previewUrl,
			// Wire compat: legacy clients expect the key; ai_run_events is gone.
			event_id: null,
			artifact: legacyArtifactFromResource(resource),
		},
		{ status: 201 },
	);
}
