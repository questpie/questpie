import { collection } from "questpie";
import { uniqueIndex } from "questpie/drizzle-pg-core";

export const aiModelsCollection = collection("ai_models")
  .fields(({ f }) => ({
    name: f.text().required().label({ en: "Name" }),
    provider: f.relation("ai_providers").required().label({ en: "Provider" }),
    modelId: f.text().required().label({ en: "Model ID" }),
    runtime: f
      .select([
        { value: "claude-code", label: { en: "Claude Code" } },
        { value: "codex", label: { en: "Codex" } },
        { value: "opencode", label: { en: "OpenCode" } },
        { value: "gemini", label: { en: "Gemini" } },
        { value: "copilot", label: { en: "Copilot" } },
        { value: "cursor", label: { en: "Cursor" } },
      ])
      .label({ en: "Runtime" }),
    maxTokens: f.number().label({ en: "Max Tokens" }),
    capabilities: f.json().label({ en: "Capabilities" }),
    config: f.json().label({ en: "Config" }),
    enabled: f.boolean().default(true).label({ en: "Enabled" }),
  }))
  .title(({ f }) => f.name)
  .indexes(({ table }) => [
    uniqueIndex("ai_models_provider_model_unique").on(
      table.provider as any,
      table.modelId as any,
    ),
  ])
  .set("admin", {
    label: { en: "AI Models" },
    icon: { type: "icon", props: { name: "ph:cpu" } },
  })
  .set("adminList", {
    view: "collection-table",
    showSearch: true,
    showFilters: true,
    showToolbar: true,
  });
