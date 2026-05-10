import { useCollectionList } from "@questpie/admin/client";
import { useState } from "react";

export interface AiProvider {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
}

export interface AiModel {
  id: string;
  name: string;
  provider: string;
  modelId: string;
  runtime: string;
  enabled: boolean;
}

export function useAiProviders() {
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const providersQuery = useCollectionList("ai_providers", {
    where: { enabled: true },
    limit: 100,
  });

  const modelsQuery = useCollectionList("ai_models", {
    where: { enabled: true },
    limit: 100,
  });

  return {
    providers: (providersQuery.data?.docs ?? []) as AiProvider[],
    models: (modelsQuery.data?.docs ?? []) as AiModel[],
    selectedModel,
    setSelectedModel,
  };
}
