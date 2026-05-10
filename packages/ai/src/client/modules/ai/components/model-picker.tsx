import { useAiProviders } from "../hooks/use-ai-providers.js";

export function ModelPicker() {
  const { models, selectedModel, setSelectedModel } = useAiProviders();

  return (
    <select
      data-ai-model-picker
      value={selectedModel ?? ""}
      onChange={(e) => setSelectedModel(e.target.value || null)}
    >
      <option value="">Auto</option>
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </select>
  );
}
