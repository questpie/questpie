import { ApiError } from "questpie/errors";

import type { AppCollections, WorkflowContextCollections } from "./app-types";
import { asRecord, isRecord, relationId } from "./records";

type Collections = AppCollections;

export type RuntimeId = "claude-code" | "codex";

export interface ResolveRuntimeInput {
	modelId?: string | null;
	projectId?: string | null;
	runtime?: RuntimeId | null;
}

export interface RuntimeResolution {
	runtime: RuntimeId;
	model: Record<string, unknown> | null;
	provider: Record<string, unknown> | null;
	modelId: string | null;
	providerId: string | null;
	providerConfig: Record<string, unknown>;
}

function runtimeFromValue(value: unknown): RuntimeId | null {
	if (value === "claude-code" || value === "codex") {
		return value;
	}
	return null;
}

async function loadProvider(
	collections: Collections,
	model: Record<string, unknown> | null,
) {
	const providerValue = model?.provider;
	if (isRecord(providerValue)) return providerValue;
	const providerId = relationId(providerValue);
	if (!providerId) return null;
	return (await collections.providers.findOne({
		where: { id: providerId },
	})) as Record<string, unknown> | null;
}

async function loadModel(
	collections: Collections,
	modelId?: string | null,
	projectId?: string | null,
) {
	if (modelId) {
		const model = await collections.models.findOne({
			where: { id: modelId },
			with: { provider: true },
		});
		if (!model) throw ApiError.notFound("Model", modelId);
		return model as Record<string, unknown>;
	}

	const result = await collections.models.find({
		where: { enabled: true },
		with: { provider: true },
		limit: 100,
	});
	const docs = result.docs as Array<Record<string, unknown>>;
	if (!projectId) return docs[0] ?? null;

	return (
		docs.find((model) => {
			const provider = isRecord(model.provider) ? model.provider : null;
			return relationId(provider?.project) === projectId;
		}) ??
		docs.find((model) => {
			const provider = isRecord(model.provider) ? model.provider : null;
			return !provider?.project;
		}) ??
		docs[0] ??
		null
	);
}

export async function resolveRuntimeSelection(
	ctx: WorkflowContextCollections,
	input: ResolveRuntimeInput = {},
): Promise<RuntimeResolution> {
	const model = await loadModel(
		ctx.collections,
		input.modelId,
		input.projectId,
	);
	const provider = await loadProvider(ctx.collections, model);
	const runtime = input.runtime ?? runtimeFromValue(model?.runtime) ?? "codex";
	const providerConfig = {
		...asRecord(provider?.config),
		...asRecord(model?.config),
	};

	return {
		runtime,
		model,
		provider,
		modelId: relationId(model),
		providerId: relationId(provider),
		providerConfig,
	};
}
