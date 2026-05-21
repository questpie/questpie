import { ApiError } from "questpie/errors";

type Collections = Questpie.WorkflowContext["collections"];

export type RuntimeId = "claude-code" | "codex" | "opencode";

export interface ResolveRuntimeInput {
	modelId?: string | null;
	capabilityId?: string | null;
	projectId?: string | null;
	runtime?: RuntimeId | null;
}

export interface RuntimeResolution {
	runtime: RuntimeId;
	model: Record<string, unknown> | null;
	provider: Record<string, unknown> | null;
	capability: Record<string, unknown> | null;
	modelId: string | null;
	providerId: string | null;
	providerConfig: Record<string, unknown>;
	toolPolicy: unknown;
	contextRefs: unknown;
	promptRefs: unknown;
	runtimeHints: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function relationId(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (isRecord(value) && typeof value.id === "string") return value.id;
	return null;
}

function runtimeFromValue(value: unknown): RuntimeId | null {
	if (value === "claude-code" || value === "codex" || value === "opencode") {
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

async function loadCapability(
	collections: Collections,
	capabilityId?: string | null,
) {
	if (!capabilityId) return null;
	const capability = await collections.capabilities.findOne({
		where: { id: capabilityId },
		with: { defaultModel: true },
	});
	if (!capability) throw ApiError.notFound("Capability", capabilityId);
	return capability as Record<string, unknown>;
}

export async function resolveRuntimeSelection(
	ctx: Pick<Questpie.WorkflowContext, "collections">,
	input: ResolveRuntimeInput = {},
): Promise<RuntimeResolution> {
	const capability = await loadCapability(ctx.collections, input.capabilityId);
	const defaultModelId = relationId(capability?.defaultModel);
	const explicitModelId = input.modelId ?? defaultModelId;
	const model = await loadModel(
		ctx.collections,
		explicitModelId,
		input.projectId,
	);
	const provider = await loadProvider(ctx.collections, model);
	const runtimeHints = asRecord(capability?.runtimeHints);
	const runtime =
		input.runtime ??
		runtimeFromValue(model?.runtime) ??
		runtimeFromValue(runtimeHints.runtime) ??
		"codex";
	const providerConfig = {
		...asRecord(provider?.config),
		...asRecord(model?.config),
	};

	return {
		runtime,
		model,
		provider,
		capability,
		modelId: relationId(model),
		providerId: relationId(provider),
		providerConfig,
		toolPolicy: capability?.allowedTools ?? null,
		contextRefs: capability?.contextRefs ?? null,
		promptRefs: capability?.promptRefs ?? null,
		runtimeHints,
	};
}
