import { service } from "questpie";

export type RuntimeKind =
  | "claude-code"
  | "codex"
  | "opencode"
  | "gemini"
  | "copilot"
  | "cursor";

export interface ResolveProviderInput {
  model?: string | null;
  provider?: string | null;
  runtime?: RuntimeKind | null;
}

export interface ResolvedProvider {
  runtime: RuntimeKind;
  modelId: string | null;
  providerId: string | null;
  providerConfig: Record<string, unknown>;
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

function runtimeFromValue(value: unknown): RuntimeKind | null {
  const valid: RuntimeKind[] = [
    "claude-code",
    "codex",
    "opencode",
    "gemini",
    "copilot",
    "cursor",
  ];
  return valid.includes(value as RuntimeKind) ? (value as RuntimeKind) : null;
}

export default service()
  .lifecycle("singleton")
  .create((ctx) => {
    const collections = ctx.collections as any;

    async function loadModel(modelId?: string | null) {
      if (modelId) {
        return collections.ai_models.findOne({
          where: { id: modelId },
          with: { provider: true },
        });
      }
      const result = await collections.ai_models.find({
        where: { enabled: true },
        with: { provider: true },
        limit: 1,
      });
      return result.docs[0] ?? null;
    }

    async function loadProvider(model: Record<string, unknown> | null) {
      if (!model) return null;
      const providerValue = model.provider;
      if (isRecord(providerValue)) return providerValue;
      const providerId = relationId(providerValue);
      if (!providerId) return null;
      return collections.ai_providers.findOne({ where: { id: providerId } });
    }

    return {
      async resolve(input: ResolveProviderInput = {}): Promise<ResolvedProvider> {
        const model = await loadModel(input.model);
        const provider = await loadProvider(model);
        const runtime =
          input.runtime ??
          runtimeFromValue(model?.runtime) ??
          "claude-code";
        const providerConfig = {
          ...asRecord(provider?.config),
          ...asRecord(model?.config),
        };

        return {
          runtime,
          modelId: relationId(model),
          providerId: relationId(provider),
          providerConfig,
        };
      },

      async listProviders() {
        const result = await collections.ai_providers.find({
          where: { enabled: true },
          limit: 100,
        });
        return result.docs;
      },

      async listModels(providerId?: string) {
        const where: Record<string, unknown> = { enabled: true };
        if (providerId) where.provider = providerId;
        const result = await collections.ai_models.find({
          where,
          limit: 100,
        });
        return result.docs;
      },
    };
  });
