import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiProvidersCollection = collection("ai_providers")
  .fields(({ f }) => ({
    name: f.text().required().label({ en: "Name" }),
    type: f
      .select([
        { value: "anthropic", label: { en: "Anthropic" } },
        { value: "openai", label: { en: "OpenAI" } },
        { value: "local", label: { en: "Local" } },
        { value: "custom", label: { en: "Custom" } },
      ])
      .label({ en: "Type" }),
    apiEndpoint: f.text().label({ en: "API Endpoint" }),
    secretRef: f.text().label({ en: "Secret Ref" }),
    config: f.json().label({ en: "Config" }),
    enabled: f.boolean().default(true).label({ en: "Enabled" }),
  }))
  .title(({ f }) => f.name)
  .indexes(({ table }) => [
    index("ai_providers_type_enabled_idx").on(
      table.type as any,
      table.enabled as any,
    ),
  ])
  .set("admin", {
    label: { en: "AI Providers" },
    icon: { type: "icon", props: { name: "ph:plugs-connected" } },
  })
  .set("adminList", {
    view: "collection-table",
    showSearch: true,
    showFilters: true,
    showToolbar: true,
  });
