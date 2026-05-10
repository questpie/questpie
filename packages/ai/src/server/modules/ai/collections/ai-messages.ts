import { collection } from "questpie";
import { index } from "questpie/drizzle-pg-core";

export const aiMessagesCollection = collection("ai_messages")
  .fields(({ f }) => ({
    session: f.relation("ai_sessions").required().label({ en: "Session" }),
    role: f
      .select([
        { value: "user", label: { en: "User" } },
        { value: "assistant", label: { en: "Assistant" } },
        { value: "system", label: { en: "System" } },
        { value: "tool", label: { en: "Tool" } },
      ])
      .required()
      .label({ en: "Role" }),
    content: f.json().label({ en: "Content" }),
    parts: f.json().label({ en: "Parts" }),
    run: f.relation("ai_runs").label({ en: "Run" }),
    model: f.text().label({ en: "Model" }),
    provider: f.text().label({ en: "Provider" }),
    metadata: f.json().label({ en: "Metadata" }),
  }))
  .indexes(({ table }) => [
    index("ai_messages_session_idx").on(table.session as any),
    index("ai_messages_run_idx").on(table.run as any),
  ])
  .set("admin", {
    label: { en: "AI Messages" },
    icon: { type: "icon", props: { name: "ph:chat-text" } },
  })
  .set("adminList", {
    view: "collection-table",
    showSearch: true,
    showFilters: true,
    showToolbar: true,
  });
