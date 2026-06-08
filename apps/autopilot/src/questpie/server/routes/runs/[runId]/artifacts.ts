import { ApiError } from "questpie/errors";
import { route } from "questpie/services";
import { z } from "zod";

import {
	activeRunStatus,
	artifactContentUrl,
	legacyArtifactFromResource,
	legacyArtifactRefKinds,
	normalizeLegacyArtifact,
} from "../../../lib/legacy-run-artifacts";
import { relationId } from "../../../lib/records";
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

function requestActor(ctx: Questpie.AppContext & { request: Request }) {
	if (ctx.session?.user?.id) return String(ctx.session.user.id);
	throw ApiError.unauthorized("Authentication required");
}

export default route()
	.get()
	.post()
	.access(sessionOnly)
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => {
		if (ctx.request.method === "GET") {
			requestActor(ctx);
			const resources = await ctx.collections.assets.find({
				where: { run: ctx.params.runId },
				limit: 500,
				orderBy: { createdAt: "asc" },
			});
			return json(resources.docs.map(legacyArtifactFromResource));
		}

		const input = artifactSchema.parse(await parseJson(ctx.request));
		const actor = requestActor(ctx);
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

		const aiRunId = relationId(run.aiRun);
		const event = aiRunId
			? await ctx.collections.ai_run_events.create({
					run: aiRunId,
					type: "artifact",
					level: "info",
					summary: input.title,
					meta: {
						actor,
						artifactId: resource.id,
						knowledgeResourceId: resource.id,
						kind: input.kind,
						previewUrl,
					},
				})
			: null;

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
				event_id: event?.id ?? null,
				artifact: legacyArtifactFromResource(resource),
			},
			{ status: 201 },
		);
	});
